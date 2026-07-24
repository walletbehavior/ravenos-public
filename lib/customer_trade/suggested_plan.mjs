export function unavailableSuggestedPlan(reason = "Evidence sample is still forming.") {
  return {
    status: "unavailable",
    as_of: new Date().toISOString(),
    asset: null,
    evidence_contract: null,
    entry_context: "",
    stop: {
      value_pct: null,
      reason,
      sample: 0,
    },
    take_profits: [],
    runner_pct: null,
    risks: [reason],
    editable: true,
    disclaimer: "Decision support only. User review and authorization required.",
  };
}

export function createSuggestedPlanContract(input = {}) {
  if (input.status && input.status !== "available") {
    return unavailableSuggestedPlan(input.reason || "Suggestion unavailable.");
  }
  const sample = Number(input.sample || input.evidence_contract?.sample?.usable || 0);
  if (!Number.isFinite(sample) || sample <= 0) return unavailableSuggestedPlan("No usable public evidence sample for this asset.");
  return {
    status: "sample_forming",
    as_of: input.as_of || new Date().toISOString(),
    asset: input.asset || null,
    evidence_contract: input.evidence_contract || null,
    entry_context: String(input.entry_context || "Public structure context only."),
    stop: {
      value_pct: null,
      reason: "Stop level requires user selection until plan policy is activated.",
      sample,
    },
    take_profits: [],
    runner_pct: null,
    risks: Array.isArray(input.risks) ? input.risks.map(String) : ["User review required."],
    editable: true,
    disclaimer: "Decision support only. User review and authorization required.",
  };
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function unavailableEvidencePlan(reason = "No mature same-instrument path sample is available.") {
  return {
    schema_version: "ravenos.plan_preview.v1",
    state: "unavailable",
    unavailable_reason: reason,
    enabled_by_default: false,
    opt_in_required: true,
    production_qualified: false,
    personalized: false,
    executable: false,
    signing_available: false,
    submission_available: false,
    levels: null,
  };
}

export function createEvidenceBoundPlanPreview(context = {}, { minimumSample = 20 } = {}) {
  if (
    context?.context_available !== true
    || !context?.public_context_id
    || !context?.instrument_id
    || !context?.observed_at
  ) {
    return unavailableEvidencePlan("No current exact-instrument Raven read is available.");
  }
  const direction = String(context.observed_side || "").toLowerCase();
  const referencePrice = finite(context.entry_reference?.price ?? context.plan_preview?.reference_price);
  const outcomes = context.outcomes || {};
  const sampleSize = Math.max(0, Math.trunc(finite(outcomes.sample_size ?? context.plan_preview?.sample_size) || 0));
  const favorablePct = finite(outcomes.median_favorable_excursion_pct ?? context.plan_preview?.favorable_excursion_reference_pct);
  const adversePct = finite(outcomes.median_adverse_excursion_pct ?? context.plan_preview?.adverse_excursion_reference_pct);
  const maturity = String(outcomes.evidence_maturity || context.plan_preview?.evidence_maturity || "forming");
  if (!["long", "short"].includes(direction)) return unavailableEvidencePlan("The current Raven read has no directional research context.");
  if (!(referencePrice > 0)) return unavailableEvidencePlan("The decision-time reference price is unavailable.");
  if (sampleSize < Math.max(1, Math.trunc(minimumSample))) return unavailableEvidencePlan("The same-instrument historical sample is still forming.");
  if (!(favorablePct > 0) || !(adversePct < 0)) return unavailableEvidencePlan("Favorable and adverse path references are incomplete.");
  if (!["developing", "historical_sample", "validated"].includes(maturity)) {
    return unavailableEvidencePlan("The same-instrument path evidence is not mature enough for a plan preview.");
  }

  const directionMultiplier = direction === "long" ? 1 : -1;
  const targetPrice = referencePrice * (1 + directionMultiplier * favorablePct / 100);
  const riskPrice = referencePrice * (1 + directionMultiplier * adversePct / 100);
  if (!(targetPrice > 0) || !(riskPrice > 0)) return unavailableEvidencePlan("The historical path references produced invalid price levels.");

  return {
    schema_version: "ravenos.plan_preview.v1",
    plan_id: `${context.public_context_id}:plan:v1`,
    state: "research_only",
    enabled_by_default: false,
    opt_in_required: true,
    instrument_id: context.instrument_id,
    direction,
    as_of: context.observed_at,
    frozen_context_id: context.public_context_id,
    review_horizon: context.plan_preview?.review_horizon || "24h research window",
    sample_size: sampleSize,
    evidence_maturity: maturity,
    levels: {
      entry_reference: {
        price: referencePrice,
        observed_at: context.entry_reference?.observed_at || context.observed_at,
        source: context.entry_reference?.source || "decision-time market reference",
      },
      target_reference: {
        price: targetPrice,
        excursion_pct: favorablePct,
        source: "median favorable excursion from future-only same-instrument paths",
      },
      risk_reference: {
        price: riskPrice,
        excursion_pct: adversePct,
        source: "median adverse excursion from future-only same-instrument paths",
      },
    },
    production_qualified: false,
    personalized: false,
    executable: false,
    signing_available: false,
    submission_available: false,
    disclaimer: "Research references only. These are not personalized targets, stops, or orders.",
  };
}
