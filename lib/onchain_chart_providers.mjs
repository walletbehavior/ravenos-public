export const RAVENOS_ONCHAIN_CHART_PROVIDER_REGISTRY_SCHEMA = "ravenos.onchain_chart_provider_registry.v1";

const DEFAULT_PROVIDER_ORDER = Object.freeze(["dexpaprika", "coingecko_onchain"]);

const PROVIDERS = Object.freeze({
  dexpaprika: Object.freeze({
    id: "dexpaprika",
    label: "DexPaprika",
    base_url: "https://api.dexpaprika.com",
    exact_pool_ohlcv: true,
    provider_networks: Object.freeze({
      solana: "solana",
      base: "base",
      ethereum: "ethereum",
      robinhood: "robinhood",
    }),
    intervals: Object.freeze(["1m", "5m", "15m", "1h", "4h", "1d"]),
    provider_intervals: Object.freeze(["1m", "5m", "10m", "15m", "30m", "1h", "6h", "12h", "24h"]),
    deterministic_derived_intervals: Object.freeze({
      "15m": "5m",
      "1h": "15m",
      "4h": "1h",
      "1d": "1h",
    }),
    prohibited_derivations: Object.freeze(["1m_to_5m"]),
    maximum_source_bars_per_request: 366,
    live_update_support: "bounded_server_poll",
    credential_mode: "none_on_free_evaluation",
    attribution_required: true,
    attribution_label: "Powered by DexPaprika",
    commercial_state: "free_development_only",
    production_state: "blocked_pending_paid_plan_and_rights_verification",
  }),
  coingecko_onchain: Object.freeze({
    id: "coingecko_onchain",
    label: "CoinGecko Onchain",
    public_label: "GeckoTerminal",
    keyless_base_url: "https://api.geckoterminal.com/api/v2",
    demo_base_url: "https://api.coingecko.com/api/v3/onchain",
    commercial_base_url: "https://pro-api.coingecko.com/api/v3/onchain",
    exact_pool_ohlcv: true,
    provider_networks: Object.freeze({
      solana: "solana",
      base: "base",
      ethereum: "eth",
      robinhood: "robinhood",
    }),
    intervals: Object.freeze(["1m", "5m", "15m", "1h", "4h", "1d"]),
    maximum_source_bars_per_request: 1000,
    live_update_support: "bounded_server_poll",
    credential_mode: "generic_server_secret",
    server_secret_binding: "ONCHAIN_CHART_PROVIDER_SECRET",
    legacy_server_secret_binding: "COINGECKO_PRO_API_KEY",
    supported_plans: Object.freeze(["demo", "basic", "analyst", "lite", "pro", "enterprise"]),
    attribution_required: true,
    attribution_label: "Data provided by CoinGecko",
    attribution_url: "https://www.coingecko.com/",
    commercial_state: "license_unverified",
    production_state: "blocked_pending_plan_rights_and_binding_verification",
  }),
});

export const RAVENOS_ONCHAIN_CHART_PROVIDER_REGISTRY = Object.freeze({
  schema_version: RAVENOS_ONCHAIN_CHART_PROVIDER_REGISTRY_SCHEMA,
  revision: "2026-07-22",
  required_release_intervals: Object.freeze(["1m", "5m", "15m", "1h", "4h", "1d"]),
  one_minute_policy: Object.freeze({
    required_for_every_advertised_chart_ready_market: true,
    minimum_useful_bars: 120,
    provider_native_or_independently_qualified: true,
    raven_observation_substitution: false,
    subminute_derivation: false,
  }),
  default_evaluation_order: DEFAULT_PROVIDER_ORDER,
  providers: PROVIDERS,
  production_promotion_eligible: false,
  production_blockers: Object.freeze([
    "commercial_rights_unverified",
    "exact_pool_anchor_matrix_incomplete",
    "one_minute_anchor_matrix_incomplete",
    "rate_behavior_not_production_qualified",
    "production_provider_binding_not_selected",
  ]),
});

function cleanProviderId(value) {
  const clean = String(value || "").trim().toLowerCase();
  if (clean === "coingecko") return "coingecko_onchain";
  return clean;
}

function cleanPlan(value) {
  return String(value || "").trim().toLowerCase();
}

function explicitBoolean(value) {
  const clean = String(value ?? "").trim().toLowerCase();
  if (clean === "true" || clean === "1") return true;
  if (clean === "false" || clean === "0") return false;
  return null;
}

export function onchainChartProviderOrder(env = {}) {
  const selected = cleanProviderId(env.ONCHAIN_CHART_PROVIDER);
  if (selected) {
    if (!PROVIDERS[selected]) throw new Error(`unknown_onchain_chart_provider:${selected}`);
    return [selected];
  }
  const configured = String(env.RAVENOS_ONCHAIN_CHART_PROVIDER_ORDER || "").trim();
  if (!configured) return [...DEFAULT_PROVIDER_ORDER];
  const requested = configured.split(",").map(cleanProviderId).filter(Boolean);
  const unknown = requested.filter((providerId) => !PROVIDERS[providerId]);
  if (unknown.length) throw new Error(`unknown_onchain_chart_provider:${unknown.join(",")}`);
  const unique = [...new Set(requested)];
  if (!unique.length) throw new Error("onchain_chart_provider_order_empty");
  return unique;
}

export function onchainChartProvider(providerId) {
  return PROVIDERS[cleanProviderId(providerId)] || null;
}

export function onchainProviderNetwork(providerId, chain) {
  const provider = onchainChartProvider(providerId);
  return provider?.provider_networks?.[String(chain || "").trim().toLowerCase()] || null;
}

export function normalizeProviderPoolAddress(chain, poolAddress) {
  const cleanChain = String(chain || "").trim().toLowerCase();
  const cleanPool = String(poolAddress || "").trim();
  if (!cleanPool) return "";
  return cleanChain === "solana" ? cleanPool : cleanPool.toLowerCase();
}

export function onchainProviderRuntime(providerId, env = {}) {
  const provider = onchainChartProvider(providerId);
  if (!provider) throw new Error(`unknown_onchain_chart_provider:${providerId}`);
  if (provider.id === "coingecko_onchain") {
    const selectedProvider = cleanProviderId(env.ONCHAIN_CHART_PROVIDER);
    const genericSecret = !selectedProvider || selectedProvider === provider.id
      ? String(env[provider.server_secret_binding] || "").trim()
      : "";
    const legacySecret = String(env[provider.legacy_server_secret_binding] || "").trim();
    const secret = genericSecret || legacySecret;
    const configuredPlan = cleanPlan(env.ONCHAIN_CHART_PROVIDER_PLAN);
    const plan = configuredPlan || (legacySecret ? "legacy_pro" : "");
    const commercialConfigured = explicitBoolean(env.ONCHAIN_CHART_PROVIDER_COMMERCIAL);
    const releaseEnforced = String(env.RAVENOS_RELEASE_ENFORCE || "") === "1";
    const productionProvider = cleanProviderId(env.RAVENOS_ONCHAIN_CHART_PRODUCTION_PROVIDER);
    const releaseQualified = releaseEnforced
      && String(env.RAVENOS_ONCHAIN_CHART_PRODUCTION_QUALIFIED || "") === "1"
      && productionProvider === provider.id;
    const keylessDiagnostic = String(env.RAVENOS_ALLOW_KEYLESS_GECKOTERMINAL_DIAGNOSTIC || "") === "1";
    const demo = Boolean(secret) && plan === "demo";
    const paid = Boolean(secret) && (["basic", "analyst", "lite", "pro", "enterprise", "legacy_pro"].includes(plan));
    const productionQualified = releaseQualified && paid && commercialConfigured === true;
    const validCredential = demo || paid;
    const missingSecret = Boolean(plan) && !secret;
    const invalidPlan = Boolean(secret) && !validCredential;
    let runtimeBlockReason = null;
    if (missingSecret) runtimeBlockReason = "onchain_chart_provider_secret_missing";
    else if (invalidPlan) runtimeBlockReason = "onchain_chart_provider_plan_invalid";
    else if (!validCredential && !keylessDiagnostic) runtimeBlockReason = "keyless_geckoterminal_application_fallback_forbidden";
    else if (!validCredential && releaseEnforced) runtimeBlockReason = "keyless_geckoterminal_forbidden_in_release";
    return {
      ...provider,
      base_url: demo ? provider.demo_base_url : paid ? provider.commercial_base_url : provider.keyless_base_url,
      provider_tier: demo ? "coingecko_demo" : paid ? (plan === "legacy_pro" ? "coingecko_pro" : `coingecko_${plan}`) : "geckoterminal_keyless_diagnostic",
      provider_plan: plan || "keyless_diagnostic",
      request_headers: demo
        ? { "x-cg-demo-api-key": secret }
        : paid ? { "x-cg-pro-api-key": secret } : {},
      credential_present: validCredential,
      credential_binding: validCredential ? provider.server_secret_binding : null,
      commercial_configured: commercialConfigured === true,
      commercial_state: demo
        ? "noncommercial_evaluation"
        : productionQualified
          ? "commercial_qualified"
          : paid && commercialConfigured === true
            ? "commercial_configured_unverified"
            : paid ? "commercial_not_enabled" : "keyless_diagnostic_only",
      production_qualified: productionQualified,
      production_state: productionQualified ? "qualified_for_production" : provider.production_state,
      refresh_seconds: demo ? 60 : paid ? 10 : null,
      runtime_allowed: runtimeBlockReason === null,
      runtime_block_reason: runtimeBlockReason,
    };
  }
  return {
    ...provider,
    provider_tier: "anonymous_free_evaluation",
    request_headers: {},
    credential_present: false,
  };
}
