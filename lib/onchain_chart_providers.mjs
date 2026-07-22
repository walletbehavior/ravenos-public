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
    public_base_url: "https://api.geckoterminal.com/api/v2",
    paid_base_url: "https://pro-api.coingecko.com/api/v3/onchain",
    exact_pool_ohlcv: true,
    provider_networks: Object.freeze({
      solana: "solana",
      base: "base",
      ethereum: "eth",
    }),
    intervals: Object.freeze(["1m", "5m", "15m", "1h", "4h", "1d"]),
    maximum_source_bars_per_request: 1000,
    live_update_support: "bounded_server_poll",
    credential_mode: "optional_server_secret",
    server_secret_binding: "COINGECKO_PRO_API_KEY",
    attribution_required: true,
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
  return String(value || "").trim().toLowerCase();
}

export function onchainChartProviderOrder(env = {}) {
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
    const secret = String(env[provider.server_secret_binding] || "").trim();
    const releaseEnforced = String(env.RAVENOS_RELEASE_ENFORCE || "") === "1";
    return {
      ...provider,
      base_url: secret ? provider.paid_base_url : provider.public_base_url,
      provider_tier: secret ? "coingecko_pro" : "geckoterminal_public",
      request_headers: secret ? { "x-cg-pro-api-key": secret } : {},
      credential_present: Boolean(secret),
      runtime_allowed: Boolean(secret) || !releaseEnforced,
      runtime_block_reason: !secret && releaseEnforced ? "keyless_geckoterminal_forbidden_in_release" : null,
    };
  }
  return {
    ...provider,
    provider_tier: "anonymous_free_evaluation",
    request_headers: {},
    credential_present: false,
  };
}
