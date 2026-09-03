export const CUSTOMER_LIVE_EXECUTION_GATE_SCHEMA = "ravenos.customer_live_execution_gate.v1";

// This source-level boundary is intentionally narrower than Raven's older
// quote-review feature flags. It authorizes only user-wallet signing and the
// reviewed submission adapters in this milestone. Raven still has no signer,
// custody, transfer, withdrawal, or arbitrary-call authority.
export const CustomerLiveExecutionAuthorization = Object.freeze({
  browser_wallet_signing: true,
  hyperliquid_wallet_submission: true,
  // The only admitted Solana path is a server-reviewed Jupiter v0 transaction
  // signed by the connected customer wallet and reconciled against Solana.
  solana_signed_transaction_submission: true,
  // EVM transactions are submitted by the connected customer wallet only
  // after Raven binds a short-lived quote to one exact chain, market, token
  // pair, fee recipient, and taker. Raven never receives a signer.
  evm_wallet_transaction_submission: true,
  raven_signing: false,
  raven_private_key_access: false,
  custody: false,
  arbitrary_transaction_submission: false,
});

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const CLEAR_KILL_SWITCH = "clear";
const DEFAULT_MAX_SESSION_AGE_SECONDS = 12 * 60 * 60;
const MAX_SESSION_AGE_SECONDS = 24 * 60 * 60;

function enabled(value) {
  return TRUE_VALUES.has(String(value ?? "").trim().toLowerCase());
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function canaryUsers(value) {
  return new Set(String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => /^usr_[A-Za-z0-9_-]{8,120}$/.test(entry) || entry === "*"));
}

export function resolveCustomerLiveExecutionGate(env = {}, principal = null, { nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  const users = canaryUsers(env.RAVENOS_CUSTOMER_TRADE_LIVE_USERS);
  const globalEnabled = enabled(env.RAVENOS_CUSTOMER_TRADE_LIVE_ENABLE);
  const killSwitchClear = String(env.RAVENOS_CUSTOMER_TRADE_KILL_SWITCH || "").trim().toLowerCase() === CLEAR_KILL_SWITCH;
  const sourceBoundaryReady = CustomerLiveExecutionAuthorization.browser_wallet_signing
    && !CustomerLiveExecutionAuthorization.raven_signing
    && !CustomerLiveExecutionAuthorization.custody;
  const hyperliquidSourceReady = sourceBoundaryReady && CustomerLiveExecutionAuthorization.hyperliquid_wallet_submission;
  const solanaSourceReady = sourceBoundaryReady && CustomerLiveExecutionAuthorization.solana_signed_transaction_submission;
  const robinhoodSourceReady = sourceBoundaryReady && CustomerLiveExecutionAuthorization.evm_wallet_transaction_submission;
  const sourceReady = hyperliquidSourceReady || solanaSourceReady || robinhoodSourceReady;
  const configured = globalEnabled && killSwitchClear && users.size > 0;
  const userId = String(principal?.user_id || "").trim();
  const authenticatedAt = Number(principal?.authenticated_at);
  const maximumSessionAgeSeconds = integer(
    env.RAVENOS_CUSTOMER_TRADE_MAX_SESSION_AGE_SECONDS,
    DEFAULT_MAX_SESSION_AGE_SECONDS,
    5 * 60,
    MAX_SESSION_AGE_SECONDS,
  );
  const sessionAgeSeconds = Number.isFinite(authenticatedAt) ? Math.max(0, nowSeconds - authenticatedAt) : null;
  const userAllowed = Boolean(userId && (users.has(userId) || users.has("*")));
  const recentAuthentication = sessionAgeSeconds !== null && sessionAgeSeconds <= maximumSessionAgeSeconds;
  const hyperliquidEnabled = configured && hyperliquidSourceReady && enabled(env.RAVENOS_CUSTOMER_TRADE_HYPERLIQUID_LIVE_ENABLE);
  const solanaEnabled = configured && solanaSourceReady && enabled(env.RAVENOS_CUSTOMER_TRADE_SOLANA_LIVE_ENABLE);
  const robinhoodEnabled = configured && robinhoodSourceReady && enabled(env.RAVENOS_CUSTOMER_TRADE_ROBINHOOD_LIVE_ENABLE);
  const principalAllowed = userAllowed && recentAuthentication;

  return Object.freeze({
    schema_version: CUSTOMER_LIVE_EXECUTION_GATE_SCHEMA,
    source_ready: sourceReady,
    configured,
    kill_switch_clear: killSwitchClear,
    canary_only: !users.has("*"),
    public_available: users.has("*") && configured,
    principal_allowed: principalAllowed,
    recent_authentication: recentAuthentication,
    session_age_seconds: sessionAgeSeconds,
    maximum_session_age_seconds: maximumSessionAgeSeconds,
    chains: Object.freeze({
      hyperliquid: Object.freeze({
        source_ready: hyperliquidSourceReady,
        enabled: hyperliquidEnabled,
        available_to_principal: hyperliquidSourceReady && hyperliquidEnabled && principalAllowed,
        wallet_signing: "eip712_in_connected_wallet",
        submission: "wallet_signed_direct_to_hyperliquid",
      }),
      solana: Object.freeze({
        source_ready: solanaSourceReady,
        enabled: solanaEnabled,
        available_to_principal: solanaSourceReady && solanaEnabled && principalAllowed,
        wallet_signing: "versioned_transaction_in_connected_wallet",
        submission: "raven_verified_signed_transaction_to_jupiter",
      }),
      robinhood: Object.freeze({
        source_ready: robinhoodSourceReady,
        enabled: robinhoodEnabled,
        available_to_principal: robinhoodSourceReady && robinhoodEnabled && principalAllowed,
        wallet_signing: "eip1193_transaction_in_connected_wallet",
        submission: "wallet_signed_direct_to_robinhood_chain",
      }),
    }),
    authority: CustomerLiveExecutionAuthorization,
  });
}

export function customerLiveExecutionRefusal(gate, chain) {
  const lane = gate?.chains?.[chain];
  if (!gate?.source_ready || !lane?.source_ready) return `${chain}_live_execution_source_boundary_closed`;
  if (!gate?.configured) return gate?.kill_switch_clear ? "live_execution_not_configured" : "live_execution_kill_switch_active";
  if (!lane?.enabled) return `${chain}_live_execution_disabled`;
  if (!gate?.recent_authentication) return "recent_authentication_required";
  if (!gate?.principal_allowed) return "live_execution_user_not_allowlisted";
  return null;
}

export function publicCustomerLiveExecutionCapabilities(env = {}) {
  const gate = resolveCustomerLiveExecutionGate(env);
  return Object.freeze({
    schema_version: CUSTOMER_LIVE_EXECUTION_GATE_SCHEMA,
    code_ready: gate.source_ready,
    configured: gate.configured,
    kill_switch_clear: gate.kill_switch_clear,
    canary_only: gate.canary_only,
    public_available: gate.public_available,
    authentication_required: true,
    wallet_signature_required: true,
    server_signing: false,
    custody: false,
    arbitrary_submission: false,
    chains: Object.freeze({
      hyperliquid: Object.freeze({ source_ready: gate.chains.hyperliquid.source_ready, enabled: gate.chains.hyperliquid.enabled }),
      solana: Object.freeze({ source_ready: gate.chains.solana.source_ready, enabled: gate.chains.solana.enabled }),
      robinhood: Object.freeze({ source_ready: gate.chains.robinhood.source_ready, enabled: gate.chains.robinhood.enabled }),
    }),
  });
}
