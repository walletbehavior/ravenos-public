export function evaluateReleasePromotion({ deploymentClass, chartProvider = {}, previewVerification = {} } = {}) {
  const reasons = [];
  const commercialProduction = deploymentClass === "commercial_production";
  const publicEvaluation = deploymentClass === "public_evaluation";

  if (!commercialProduction && !publicEvaluation) reasons.push("release_class_not_promotable");

  if (commercialProduction) {
    if (chartProvider.production_promotion_eligible !== true) reasons.push("commercial_provider_not_qualified");
    if (!chartProvider.production_provider) reasons.push("commercial_provider_missing");
    if (!chartProvider.production_provider_plan || chartProvider.production_provider_plan === "demo") reasons.push("commercial_plan_invalid");
    if (chartProvider.production_provider_commercial !== true) reasons.push("commercial_rights_unverified");
  }

  if (publicEvaluation) {
    const boundedPolicy = chartProvider.production_promotion_eligible === false
      && chartProvider.public_evaluation_promotion_eligible === true
      && Boolean(chartProvider.public_evaluation_provider)
      && chartProvider.public_evaluation_provider_plan === "demo"
      && chartProvider.public_evaluation_provider_commercial === false
      && chartProvider.public_evaluation_scope === "testing_and_exploration"
      && chartProvider.public_evaluation_attribution_required === true
      && chartProvider.public_evaluation_commercial_features_allowed === false
      && chartProvider.public_evaluation_customer_execution_allowed === false;
    if (!boundedPolicy) reasons.push("public_evaluation_policy_invalid");
    if (previewVerification.provider_attribution_verified !== true) reasons.push("provider_attribution_unverified");
    if (previewVerification.onchain_chart?.provider_plan !== "demo") reasons.push("preview_provider_plan_mismatch");
    if (previewVerification.onchain_chart?.fallback !== false) reasons.push("preview_provider_fallback_detected");
    if (previewVerification.execution_boundary?.signing_available !== false) reasons.push("customer_signing_available");
    if (previewVerification.execution_boundary?.submission_available !== false) reasons.push("customer_submission_available");
  }

  const intervals = chartProvider.required_intervals || [];
  if (!intervals.includes("1m") || Number(chartProvider.one_minute_minimum_useful_bars) < 120) {
    reasons.push("one_minute_contract_unqualified");
  }
  if (chartProvider.subminute_candles_required !== false) reasons.push("subminute_policy_invalid");

  return {
    eligible: reasons.length === 0,
    deployment_class: deploymentClass,
    reasons,
  };
}
