export const CustomerTradeFlags = Object.freeze({
  RAVENOS_CUSTOMER_TRADE_UI_ENABLE: false,
  RAVENOS_CUSTOMER_TRADE_QUOTE_ENABLE: false,
  RAVENOS_CUSTOMER_TRADE_SIGN_ENABLE: false,
  RAVENOS_CUSTOMER_TRADE_SUBMIT_ENABLE: false,
  RAVENOS_CUSTOMER_TRADE_SOLANA_ENABLE: false,
  RAVENOS_CUSTOMER_TRADE_BASE_ENABLE: false,
  RAVENOS_CUSTOMER_TRADE_FEES_ENABLE: false,
});

// Environment flags may enable the bounded quote-review plane, but public
// signing and submission require a separately reviewed implementation and an
// explicit source-level authorization milestone. They cannot be activated by
// stale or accidental environment configuration.
export const CustomerExecutionAuthorization = Object.freeze({
  signing: false,
  submission: false,
});

export function resolveCustomerTradeFlags(env = {}) {
  const out = {};
  for (const [key, defaultValue] of Object.entries(CustomerTradeFlags)) {
    const raw = env[key];
    out[key] = raw === undefined || raw === null || raw === "" ? defaultValue : ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
  }
  out.RAVENOS_CUSTOMER_TRADE_SIGN_ENABLE = CustomerExecutionAuthorization.signing;
  out.RAVENOS_CUSTOMER_TRADE_SUBMIT_ENABLE = CustomerExecutionAuthorization.submission;
  return out;
}

export function signingEnabled(flags = {}) {
  return Boolean(flags.RAVENOS_CUSTOMER_TRADE_SIGN_ENABLE && flags.RAVENOS_CUSTOMER_TRADE_SUBMIT_ENABLE);
}
