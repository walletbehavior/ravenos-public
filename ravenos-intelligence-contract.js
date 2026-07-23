export const RAVENOS_INTELLIGENCE_SCHEMA = "ravenos.intelligence.v1";

export const RavenDataStates = Object.freeze({
  LIVE: "live",
  DELAYED: "delayed",
  DEMO: "demo",
  HISTORICAL: "historical",
  SIMULATED: "simulated",
  PAPER: "paper",
  SHADOW: "shadow",
  AWAITING_CONFIRMATION: "awaiting_confirmation",
  MATURED: "matured",
  INSUFFICIENT_EVIDENCE: "insufficient_evidence",
  DATA_UNAVAILABLE: "data_unavailable",
});

export const RavenDataStateLabels = Object.freeze({
  [RavenDataStates.LIVE]: "Live",
  [RavenDataStates.DELAYED]: "Delayed",
  [RavenDataStates.DEMO]: "Demo",
  [RavenDataStates.HISTORICAL]: "Historical",
  [RavenDataStates.SIMULATED]: "Simulated",
  [RavenDataStates.PAPER]: "Paper",
  [RavenDataStates.SHADOW]: "Shadow",
  [RavenDataStates.AWAITING_CONFIRMATION]: "Awaiting confirmation",
  [RavenDataStates.MATURED]: "Matured",
  [RavenDataStates.INSUFFICIENT_EVIDENCE]: "Insufficient evidence",
  [RavenDataStates.DATA_UNAVAILABLE]: "Data unavailable",
});

const DECLARED_STATE_ALIASES = Object.freeze({
  current: RavenDataStates.LIVE,
  fresh: RavenDataStates.LIVE,
  live: RavenDataStates.LIVE,
  stale: RavenDataStates.DELAYED,
  degraded: RavenDataStates.DELAYED,
  cached: RavenDataStates.DELAYED,
  delayed: RavenDataStates.DELAYED,
  demo: RavenDataStates.DEMO,
  sample: RavenDataStates.DEMO,
  historical: RavenDataStates.HISTORICAL,
  settled: RavenDataStates.MATURED,
  matured: RavenDataStates.MATURED,
  simulated: RavenDataStates.SIMULATED,
  simulation: RavenDataStates.SIMULATED,
  paper: RavenDataStates.PAPER,
  shadow: RavenDataStates.SHADOW,
  pending: RavenDataStates.AWAITING_CONFIRMATION,
  forming: RavenDataStates.AWAITING_CONFIRMATION,
  awaiting_confirmation: RavenDataStates.AWAITING_CONFIRMATION,
  insufficient: RavenDataStates.INSUFFICIENT_EVIDENCE,
  insufficient_evidence: RavenDataStates.INSUFFICIENT_EVIDENCE,
  unavailable: RavenDataStates.DATA_UNAVAILABLE,
  data_unavailable: RavenDataStates.DATA_UNAVAILABLE,
});

export function customerFacingText(value, fallback = "") {
  const result = String(value ?? "").trim();
  const normalized = result
    .replace(/\bpublic-safe\b/gi, "available")
    .replace(/\bpublic evidence\b/gi, "available evidence")
    .replace(/\bcurrent public structure\b/gi, "current observed structure")
    .replace(/\bpublic structure\b/gi, "observed structure")
    .replace(/\bpublic context\b/gi, "available context")
    .replace(/\bsample depth is public\b/gi, "sample depth is available")
    .replace(/\bclosest comparable\b/gi, "closest prior case")
    .replace(/\bcomparable setup\b/gi, "prior setup")
    .replace(/\bLive Activity\b/gi, "market activity")
    .replace(/\bCurrent Raven Read\b/gi, "Current market read")
    .replace(/^Raven preserved an independently admitted decision-time market observation\.?$/i, "Independent evidence confirmed a new market behavior at this exact instrument.")
    .replace(
      /^Raven froze an? (.+?) observation while (.+?) was present\.?$/i,
      (_match, behavior, context) => {
        const cleanBehavior = String(behavior || "").trim();
        const cleanContext = String(context || "").trim().replace(/\s+visible$/i, "");
        const subject = cleanBehavior ? `${cleanBehavior.charAt(0).toUpperCase()}${cleanBehavior.slice(1)}` : "Market behavior";
        return cleanContext ? `${subject} appeared while ${cleanContext} was in place.` : `${subject} appeared.`;
      },
    )
    .replace(/\bRaven froze\b/gi, "Raven observed")
    .replace(/\bfrozen decision observation\b/gi, "timestamped market observation")
    .replace(/\bfrozen observation\b/gi, "timestamped observation")
    .replace(/\bindependently admitted decision-time market observation\b/gi, "independently confirmed market behavior")
    .replace(/\bRaven currently believes\b/gi, "Current evidence indicates");
  return normalized || fallback;
}

function cleanText(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTimestamp(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoTimestamp(value) {
  const parsed = parseTimestamp(value);
  return parsed === null ? null : new Date(parsed).toISOString();
}

function list(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined && item !== "");
  return value === null || value === undefined || value === "" ? [] : [value];
}

function normalizeEvidenceItem(value, index, kind) {
  if (typeof value === "string") {
    return {
      id: `${kind}-${index + 1}`,
      label: customerFacingText(value),
      detail: "",
      quality: "unknown",
      observedAt: null,
      sourceReference: null,
    };
  }
  const row = value && typeof value === "object" ? value : {};
  return {
    id: cleanText(row.id || row.evidenceId, `${kind}-${index + 1}`),
    label: customerFacingText(row.label || row.title || row.summary || row.detail, "Evidence detail unavailable"),
    detail: customerFacingText(row.detail || row.description),
    quality: cleanText(row.quality || row.evidenceQuality, "unknown").toLowerCase(),
    observedAt: isoTimestamp(row.observedAt || row.observed_at || row.timestamp),
    sourceReference: cleanText(row.sourceReference || row.source_reference || row.source, "") || null,
  };
}

function normalizeEvidenceList(value, kind) {
  return list(value).map((item, index) => normalizeEvidenceItem(item, index, kind));
}

function normalizeSubject(value = {}) {
  const row = value && typeof value === "object" ? value : {};
  const label = customerFacingText(row.label || row.symbol || row.name || row.id, "No market selected");
  return {
    id: cleanText(row.id || row.address || row.symbol || label, "unselected"),
    type: cleanText(row.type, "market").toLowerCase(),
    label,
    symbol: cleanText(row.symbol || row.label),
    chain: cleanText(row.chain, "all").toLowerCase(),
    venue: cleanText(row.venue, "all").toLowerCase(),
    marketType: cleanText(row.marketType || row.market_type, "all").toLowerCase(),
  };
}

function normalizeConfidence(value = {}) {
  if (typeof value === "number") value = { score: value };
  if (typeof value === "string") value = { label: value };
  const row = value && typeof value === "object" ? value : {};
  const score = finiteNumber(row.score);
  let label = cleanText(row.label, "unrated").toLowerCase();
  if (label === "unrated" && score !== null) {
    label = score >= 0.75 ? "high" : score >= 0.45 ? "medium" : "low";
  }
  return {
    label,
    score,
    basis: cleanText(row.basis),
    sampleSize: finiteNumber(row.sampleSize ?? row.sample_size),
  };
}

function normalizeEvidenceQuality(value = {}) {
  if (typeof value === "string") value = { state: value };
  const row = value && typeof value === "object" ? value : {};
  return {
    state: cleanText(row.state || row.label, "unknown").toLowerCase().replaceAll(" ", "_"),
    score: finiteNumber(row.score),
    completeness: finiteNumber(row.completeness),
    lineageComplete: row.lineageComplete === true || row.lineage_complete === true,
    missingFields: list(row.missingFields || row.missing_fields).map((item) => cleanText(item)).filter(Boolean),
  };
}

export function resolveDataState(input = {}) {
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const observedAt = isoTimestamp(input.observedAt || input.observed_at || input.generatedAt || input.generated_at);
  const observedMs = parseTimestamp(observedAt);
  const declaredKey = cleanText(input.declaredState || input.declared_state || input.status, "").toLowerCase().replaceAll(" ", "_");
  const declared = DECLARED_STATE_ALIASES[declaredKey] || null;
  const durableState = [
    RavenDataStates.HISTORICAL,
    RavenDataStates.SIMULATED,
    RavenDataStates.PAPER,
    RavenDataStates.SHADOW,
    RavenDataStates.MATURED,
    RavenDataStates.INSUFFICIENT_EVIDENCE,
    RavenDataStates.DATA_UNAVAILABLE,
  ].includes(declared);

  if (durableState) {
    return {
      state: declared,
      label: RavenDataStateLabels[declared],
      observedAt,
      ageSeconds: observedMs === null ? null : Math.max(0, Math.floor((nowMs - observedMs) / 1000)),
      declaredState: declaredKey || null,
    };
  }

  if (observedMs === null) {
    const state = declared === RavenDataStates.AWAITING_CONFIRMATION
      ? RavenDataStates.AWAITING_CONFIRMATION
      : RavenDataStates.DATA_UNAVAILABLE;
    return { state, label: RavenDataStateLabels[state], observedAt: null, ageSeconds: null, declaredState: declaredKey || null };
  }

  const ageSeconds = Math.max(0, Math.floor((nowMs - observedMs) / 1000));
  const liveMaxAgeSeconds = finiteNumber(input.liveMaxAgeSeconds) ?? 120;
  const delayedMaxAgeSeconds = finiteNumber(input.delayedMaxAgeSeconds) ?? 3600;
  let state = RavenDataStates.LIVE;
  if (ageSeconds > liveMaxAgeSeconds || declared === RavenDataStates.DELAYED) state = RavenDataStates.DELAYED;
  if (ageSeconds > delayedMaxAgeSeconds && input.evidenceRole === "historical") state = RavenDataStates.HISTORICAL;
  return { state, label: RavenDataStateLabels[state], observedAt, ageSeconds, declaredState: declaredKey || null };
}

export function createIntelligenceRecord(input = {}, options = {}) {
  const subject = normalizeSubject(input.subject || options.subject);
  const freshness = resolveDataState({
    ...(input.freshness || {}),
    observedAt: input.freshness?.observedAt || input.observedAt || input.generatedAt,
    generatedAt: input.generatedAt,
    declaredState: input.freshness?.state || input.dataState,
    evidenceRole: input.evidenceRole,
    nowMs: options.nowMs,
  });
  const explicitFreshnessLabel = customerFacingText(input.freshness?.label, "");
  if (explicitFreshnessLabel) freshness.label = explicitFreshnessLabel;
  const marketStateInput = input.marketState && typeof input.marketState === "object" ? input.marketState : {};
  const setupStateInput = input.setupState && typeof input.setupState === "object" ? input.setupState : {};

  return {
    schemaVersion: RAVENOS_INTELLIGENCE_SCHEMA,
    subject,
    marketState: {
      label: customerFacingText(marketStateInput.label || marketStateInput.state, "Market state unavailable"),
      direction: cleanText(marketStateInput.direction, "neutral").toLowerCase(),
      regime: cleanText(marketStateInput.regime, "unclassified"),
      metrics: marketStateInput.metrics && typeof marketStateInput.metrics === "object" ? { ...marketStateInput.metrics } : {},
    },
    setupState: {
      state: cleanText(setupStateInput.state, "unqualified").toLowerCase().replaceAll(" ", "_"),
      confirmation: cleanText(setupStateInput.confirmation, "unconfirmed").toLowerCase().replaceAll(" ", "_"),
      progression: list(setupStateInput.progression).map((item) => cleanText(item)).filter(Boolean),
    },
    thesis: customerFacingText(input.thesis, "No current thesis is available for this context."),
    supportingEvidence: normalizeEvidenceList(input.supportingEvidence, "support"),
    contradictingEvidence: normalizeEvidenceList(input.contradictingEvidence, "contradiction"),
    catalysts: normalizeEvidenceList(input.catalysts, "catalyst"),
    invalidation: normalizeEvidenceList(input.invalidation, "invalidation"),
    timeHorizon: customerFacingText(input.timeHorizon, "not specified"),
    confidence: normalizeConfidence(input.confidence),
    evidenceQuality: normalizeEvidenceQuality(input.evidenceQuality),
    freshness,
    nextExpectedTransition: customerFacingText(input.nextExpectedTransition, "No transition is currently declared."),
    sourceReferences: list(input.sourceReferences).map((item) => cleanText(item)).filter(Boolean),
    generatedAt: isoTimestamp(input.generatedAt) || new Date(options.nowMs || Date.now()).toISOString(),
  };
}

export function adaptLegacyNarrator(payload = {}, context = {}, options = {}) {
  const completeness = payload.evidence_completeness || {};
  const confidence = payload.confidence || {};
  const freshness = payload.freshness || {};
  const role = cleanText(context.evidenceRole || payload.page, "current_synthesis");
  const declaredState = role === "historical" ? RavenDataStates.HISTORICAL : freshness.status;
  return createIntelligenceRecord({
    subject: context.subject,
    evidenceRole: role,
    marketState: {
      label: cleanText(payload.headline, "Market state unavailable"),
      regime: cleanText(payload.behavioral_authority_context?.regime, "unclassified"),
    },
    setupState: {
      state: payload.research_status || payload.behavioral_authority_context?.authority_state || "unqualified",
      confirmation: payload.behavioral_authority_context?.management_validation_status || "unconfirmed",
      progression: payload.what_changed,
    },
    thesis: payload.current_read || payload.behavioral_summary,
    supportingEvidence: payload.supporting_evidence,
    contradictingEvidence: payload.weakening_evidence,
    catalysts: payload.what_raven_is_watching,
    invalidation: payload.what_would_change_ravens_mind,
    timeHorizon: context.timeHorizon,
    confidence,
    evidenceQuality: {
      state: completeness.label || payload.behavioral_authority_context?.evidence_completeness,
      score: completeness.score,
      missingFields: payload.missing_evidence,
      lineageComplete: false,
    },
    freshness: {
      state: declaredState,
      observedAt: freshness.latest_observed_at || payload.generated_at,
    },
    generatedAt: payload.generated_at,
    nextExpectedTransition: list(payload.what_raven_is_watching)[0],
    sourceReferences: [
      ...list(payload.source_artifacts?.public),
      ...list(payload.source_artifacts?.runtime),
    ],
  }, options);
}

export function createTerminalIntelligence(facts = {}, options = {}) {
  const participation = cleanText(facts.participation, "unavailable");
  const liquidity = cleanText(facts.liquidity, "unavailable");
  const risk = cleanText(facts.risk, "unrated");
  const pressure = cleanText(facts.pressure, "unavailable");
  const supportingEvidence = [];
  const contradictingEvidence = [];

  if (participation !== "unavailable") supportingEvidence.push({ label: `Participation: ${participation}`, sourceReference: facts.participationSource });
  if (pressure !== "unavailable") supportingEvidence.push({ label: `Positioning pressure: ${pressure}`, sourceReference: facts.marketSource });
  if (/thin|fragmented|choppy|deterior/i.test(liquidity)) contradictingEvidence.push({ label: `Liquidity: ${liquidity}`, sourceReference: facts.marketSource });
  else if (liquidity !== "unavailable") supportingEvidence.push({ label: `Liquidity: ${liquidity}`, sourceReference: facts.marketSource });
  if (/elevated|high|severe/i.test(risk)) contradictingEvidence.push({ label: `Risk state: ${risk}`, sourceReference: facts.marketSource });

  return createIntelligenceRecord({
    subject: facts.subject,
    evidenceRole: "live_market_context",
    marketState: {
      label: cleanText(facts.marketState, `${facts.subject?.label || "Selected market"} context`),
      direction: facts.direction,
      regime: facts.regime,
      metrics: facts.metrics,
    },
    setupState: {
      state: facts.setupState,
      confirmation: facts.confirmation,
      progression: facts.progression,
    },
    thesis: facts.thesis,
    supportingEvidence,
    contradictingEvidence,
    catalysts: facts.catalysts,
    invalidation: facts.invalidation,
    timeHorizon: facts.timeHorizon,
    confidence: facts.confidence,
    evidenceQuality: facts.evidenceQuality,
    freshness: {
      state: facts.dataState,
      observedAt: facts.observedAt,
    },
    generatedAt: facts.generatedAt || facts.observedAt,
    nextExpectedTransition: facts.nextExpectedTransition,
    sourceReferences: facts.sourceReferences,
  }, options);
}

export function renderIntelligence(record, mode = "conciseOpportunitySummary") {
  const value = record?.schemaVersion === RAVENOS_INTELLIGENCE_SCHEMA ? record : createIntelligenceRecord(record || {});
  const support = value.supportingEvidence[0]?.label || "No confirming evidence is currently available.";
  const contradiction = value.contradictingEvidence[0]?.label || value.invalidation[0]?.label || "No explicit invalidation is currently available.";
  const subject = value.subject.label;
  const state = value.marketState.label;

  const renderings = {
    terminalHeadline: `${subject} | ${state}`,
    conciseOpportunitySummary: value.thesis,
    expandedExplanation: `${value.thesis} Confirmation: ${support} Invalidation: ${contradiction}`,
    chartAnnotation: `${value.setupState.state.replaceAll("_", " ")} | ${support}`,
    riskWarning: contradiction,
    alertCopy: `${subject}: ${state}. ${value.nextExpectedTransition}`,
    outcomePostmortem: `${subject} entered ${value.setupState.state.replaceAll("_", " ")} with ${value.evidenceQuality.state.replaceAll("_", " ")} evidence.`,
    researchBrief: `${state}. ${value.thesis} Next transition: ${value.nextExpectedTransition}`,
  };
  return renderings[mode] || renderings.conciseOpportunitySummary;
}
