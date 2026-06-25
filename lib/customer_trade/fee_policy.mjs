export function defaultFeePolicy() {
  return Object.freeze({
    provider: "none",
    chain: "all",
    trade_type: "all",
    fee_bps: 0,
    fee_token: "",
    fee_recipient: "",
    enabled: false,
    disclosure_string: "Raven fee disabled.",
    jurisdiction_policy_gate: "pre_production_review_required",
    privacy_impact: {
      label: "none",
      creates_public_raven_attribution: false,
      fee_recipient_visibility: "not_applicable",
      provider_tagging_behavior: "not_enabled",
    },
  });
}

export function feePolicyFor(input = {}) {
  const base = defaultFeePolicy();
  if (!input.enabled) return base;
  return {
    ...base,
    ...input,
    enabled: Boolean(input.enabled),
    fee_bps: Number(input.fee_bps || 0),
    privacy_impact: {
      ...base.privacy_impact,
      ...(input.privacy_impact || {}),
    },
  };
}
