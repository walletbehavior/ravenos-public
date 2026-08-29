export const CUSTOMER_TRADE_FEE_POLICY_SCHEMA = "ravenos.customer_trade_fee_policy.v1";

const PRO_FEE_MULTIPLIER_BPS = 7_000;
const SUPPORTED_TIERS = new Set(["free", "pro"]);

const FEE_SCHEDULES = Object.freeze({
  "hyperliquid:perpetual": Object.freeze({
    provider: "hyperliquid",
    chain: "hyperliquid",
    trade_type: "perpetual",
    fee_kind: "builder_fee",
    fee_parameter: "builder.f",
    fee_parameter_unit: "tenths_of_a_basis_point",
    maximum_fee_bps: 10,
    maximum_fee_parameter_value: 100,
    official_limit_label: "0.10%",
    applicability: "both_sides",
    venue_user_approval_required: true,
  }),
  "hyperliquid:spot": Object.freeze({
    provider: "hyperliquid",
    chain: "hyperliquid",
    trade_type: "spot",
    fee_kind: "builder_fee",
    fee_parameter: "builder.f",
    fee_parameter_unit: "tenths_of_a_basis_point",
    maximum_fee_bps: 100,
    maximum_fee_parameter_value: 1_000,
    official_limit_label: "1.00%",
    applicability: "spot_sell_side_only",
    venue_user_approval_required: true,
  }),
  "jupiter:spot": Object.freeze({
    provider: "jupiter",
    chain: "solana",
    trade_type: "spot",
    fee_kind: "integrator_fee",
    fee_parameter: "referralFee",
    fee_parameter_unit: "basis_points",
    minimum_fee_bps: 50,
    maximum_fee_bps: 255,
    free_fee_bps: 100,
    maximum_fee_parameter_value: 255,
    official_limit_label: "2.55%",
    applicability: "both_swap_directions",
    venue_user_approval_required: false,
    provider_share_of_integrator_fee_pct: 20,
  }),
});

function clean(value, maximum = 120) {
  return String(value ?? "").trim().toLowerCase().slice(0, maximum);
}

function scheduleKey(input = {}) {
  const provider = clean(input.provider || input.venue);
  const rawType = clean(input.trade_type || input.market_type || input.product);
  const tradeType = rawType === "perp" ? "perpetual" : rawType === "swap" ? "spot" : rawType;
  return `${provider}:${tradeType}`;
}

function recipientValid(schedule, recipient) {
  if (!schedule || !recipient) return false;
  if (schedule.provider === "hyperliquid") return /^0x[0-9a-fA-F]{40}$/.test(recipient);
  if (schedule.provider === "jupiter") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(recipient);
  return false;
}

function tierFee(maximumFeeBps, tier) {
  return tier === "pro"
    ? Math.floor((maximumFeeBps * PRO_FEE_MULTIPLIER_BPS) / 10_000)
    : maximumFeeBps;
}

function parameterValue(schedule, feeBps) {
  return schedule.fee_parameter_unit === "tenths_of_a_basis_point" ? feeBps * 10 : feeBps;
}

function percentLabel(feeBps) {
  return `${(feeBps / 100).toFixed(2)}%`;
}

export function defaultFeePolicy() {
  return Object.freeze({
    schema_version: CUSTOMER_TRADE_FEE_POLICY_SCHEMA,
    provider: "none",
    chain: "all",
    trade_type: "all",
    access_tier: "free",
    fee_kind: "none",
    fee_bps: 0,
    configured_fee_bps: 0,
    free_fee_bps: 0,
    pro_fee_bps: 0,
    fee_parameter: null,
    fee_parameter_value: 0,
    fee_parameter_unit: null,
    fee_token: "",
    fee_recipient: "",
    enabled: false,
    configuration_ready: false,
    unavailable_reason: "fee_policy_not_selected",
    discount_from_free_pct: 0,
    disclosure_string: "Raven fee is not charged in this preview.",
    jurisdiction_policy_gate: "pre_production_review_required",
    customer_controls: Object.freeze({
      disclosed_before_signature: true,
      body_or_query_tier_override_allowed: false,
      body_or_query_fee_override_allowed: false,
      venue_approval_still_required: true,
      approved_cap_shortfall_behavior: "block_and_request_approval",
    }),
    privacy_impact: Object.freeze({
      label: "none",
      creates_public_raven_attribution: false,
      fee_recipient_visibility: "not_applicable",
      provider_tagging_behavior: "not_enabled",
    }),
  });
}

export function feePolicyFor(input = {}) {
  const base = defaultFeePolicy();
  const accessTier = clean(input.access_tier || input.plan || input.tier || "free");
  if (!SUPPORTED_TIERS.has(accessTier)) {
    return Object.freeze({ ...base, access_tier: accessTier || null, unavailable_reason: "unsupported_access_tier" });
  }
  const schedule = FEE_SCHEDULES[scheduleKey(input)];
  if (!schedule) {
    return Object.freeze({ ...base, access_tier: accessTier, unavailable_reason: "unsupported_fee_schedule" });
  }

  const freeFeeBps = schedule.free_fee_bps ?? schedule.maximum_fee_bps;
  const proFeeBps = tierFee(freeFeeBps, "pro");
  const configuredFeeBps = accessTier === "pro" ? proFeeBps : freeFeeBps;
  const configuredParameterValue = parameterValue(schedule, configuredFeeBps);
  const recipient = String(input.fee_recipient || "").trim();
  const configurationReady = recipientValid(schedule, recipient);
  const requestedEnabled = input.enabled === true;
  const enabled = requestedEnabled && configurationReady;
  const discountFromFreePct = accessTier === "pro"
    ? Number((((freeFeeBps - configuredFeeBps) / freeFeeBps) * 100).toFixed(1))
    : 0;
  const disclosure = `${accessTier === "pro" ? "Pro" : "Free"} ${schedule.fee_kind === "builder_fee" ? "builder" : "Raven"} fee: ${percentLabel(configuredFeeBps)}${enabled ? "" : " · not charged in preview"}.`;

  return Object.freeze({
    ...base,
    ...schedule,
    access_tier: accessTier,
    fee_bps: enabled ? configuredFeeBps : 0,
    configured_fee_bps: configuredFeeBps,
    free_fee_bps: freeFeeBps,
    pro_fee_bps: proFeeBps,
    fee_parameter_value: enabled ? configuredParameterValue : 0,
    configured_fee_parameter_value: configuredParameterValue,
    fee_token: String(input.fee_token || ""),
    fee_recipient: enabled ? recipient : "",
    enabled,
    configuration_ready: configurationReady,
    unavailable_reason: enabled ? null : requestedEnabled ? "fee_recipient_invalid_or_missing" : "fee_collection_disabled",
    discount_from_free_pct: discountFromFreePct,
    disclosure_string: disclosure,
    privacy_impact: Object.freeze({
      label: enabled ? "onchain_fee_attribution" : "none",
      creates_public_raven_attribution: enabled,
      fee_recipient_visibility: enabled ? "public_onchain" : "not_applicable",
      provider_tagging_behavior: enabled ? schedule.fee_kind : "not_enabled",
    }),
  });
}

export function customerTradeFeeSchedule() {
  return Object.freeze(Object.fromEntries(Object.entries(FEE_SCHEDULES).map(([key, schedule]) => [key, Object.freeze({
    provider: schedule.provider,
    chain: schedule.chain,
    trade_type: schedule.trade_type,
    fee_kind: schedule.fee_kind,
    free_fee_bps: schedule.free_fee_bps ?? schedule.maximum_fee_bps,
    pro_fee_bps: tierFee(schedule.free_fee_bps ?? schedule.maximum_fee_bps, "pro"),
  })])));
}
