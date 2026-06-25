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
