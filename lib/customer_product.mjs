// One server-owned product policy. Client UI consumes the public projection.
export const RAVEN_STANDARD_EXECUTION_FEE_BPS = 100;
export const RAVEN_PRO_EXECUTION_FEE_BPS = 100;
export const RAVEN_PRO_CASHBACK_PERCENT = 30;
export const RAVEN_PRO_MONTHLY_PRICE_USD = 149;
export const RAVEN_PRO_TRIAL_DAYS = 30;
export const RAVEN_PRO_TRIAL_CARD_REQUIRED = false;
export const COPY_ADDITIONAL_FEE_BPS = 0;
// Rebate the customer's confirmed Raven execution fee before provider retention.
// Provider costs reduce Raven's retained revenue, never the customer's rebate.
export const RAVEN_CASHBACK_BASIS = "confirmed_customer_raven_fee_before_provider_share";
export const USDC_SCALE = 1_000_000n;
export const MAX_MONEY_MICROS = 9_007_199_254_740_991n;

export function moneyMicros(value) {
  if (typeof value !== "string" && typeof value !== "bigint") throw new Error("money_requires_integer_string");
  if (!/^\d{1,16}$/.test(String(value))) throw new Error("money_invalid");
  const amount = BigInt(value);
  if (amount > MAX_MONEY_MICROS) throw new Error("money_out_of_range");
  return amount;
}

export function cashbackMicros(collectedFee) {
  // Round down to micro-USDC. Never issue more than the promised proportion.
  return (moneyMicros(collectedFee) * BigInt(RAVEN_PRO_CASHBACK_PERCENT) / 100n).toString();
}

export function productFlags(env = {}) {
  const enabled = (key) => String(env[`RAVENOS_${key}`] || "") === "1";
  return Object.freeze({
    trials: enabled("PRO_FREE_TRIAL_ENABLED"), cashback: enabled("PRO_CASHBACK_ENABLED"),
    claims: enabled("PRO_CASHBACK_CLAIMS_ENABLED"), auto_apply: enabled("PRO_CASHBACK_AUTO_APPLY_ENABLED"),
    subscription_credit: enabled("PRO_CASHBACK_SUBSCRIPTION_CREDIT_ENABLED"),
    billing: enabled("PRO_ACCOUNT_BILLING_ENABLED"),
  });
}

export function publicProductPolicy() {
  return Object.freeze({ standard_execution_fee_bps: RAVEN_STANDARD_EXECUTION_FEE_BPS,
    pro_execution_fee_bps: RAVEN_PRO_EXECUTION_FEE_BPS, pro_cashback_percent: RAVEN_PRO_CASHBACK_PERCENT,
    pro_monthly_price_usd: RAVEN_PRO_MONTHLY_PRICE_USD, trial_days: RAVEN_PRO_TRIAL_DAYS,
    trial_card_required: RAVEN_PRO_TRIAL_CARD_REQUIRED, copy_additional_fee_bps: COPY_ADDITIONAL_FEE_BPS,
    cashback_basis: RAVEN_CASHBACK_BASIS, rewards_unit: "micro_usdc",
    rewards_expire: false, hyperliquid_cashback: false,
  });
}

export const AFFILIATE_COMMISSION_PERCENT = 25;
export const AFFILIATE_COMMISSION_MONTHS = 12;
export const REFERRAL_ATTRIBUTION_DAYS = 60;
export const AFFILIATE_REVENUE_BASIS = "net_external_subscription_cash_after_credits_refunds_and_chargebacks";
export function affiliatePolicy(env = {}) {
  const enabled = (key) => String(env[`RAVENOS_${key}`] || "") === "1";
  return Object.freeze({ commission_percent: AFFILIATE_COMMISSION_PERCENT, commission_months: AFFILIATE_COMMISSION_MONTHS, attribution_days: REFERRAL_ATTRIBUTION_DAYS, revenue_basis: AFFILIATE_REVENUE_BASIS,
    flags: Object.freeze({ referrals: enabled("REFERRALS_ENABLED"), enrollment: enabled("AFFILIATE_ENROLLMENT_ENABLED"), commissions: enabled("AFFILIATE_COMMISSIONS_ENABLED"), public_profile_cta: enabled("AFFILIATE_PUBLIC_PROFILE_CTA_ENABLED"), payouts: enabled("AFFILIATE_PAYOUTS_ENABLED") }) });
}
