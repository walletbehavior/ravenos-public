import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PROVIDER_ENV_NAMES = Object.freeze([
  "ONCHAIN_CHART_PROVIDER",
  "ONCHAIN_CHART_PROVIDER_PLAN",
  "ONCHAIN_CHART_PROVIDER_COMMERCIAL",
  "ONCHAIN_CHART_PROVIDER_SECRET",
  "RAVENOS_ALLOW_KEYLESS_GECKOTERMINAL_DIAGNOSTIC",
  "RAVENOS_ONCHAIN_CHART_PROVIDER_ORDER",
  "RAVENOS_ONCHAIN_CHART_PRODUCTION_PROVIDER",
  "RAVENOS_ONCHAIN_CHART_PRODUCTION_QUALIFIED",
  "RAVENOS_PUBLIC_ORIGIN_TOKEN",
  "RAVENOS_PUBLIC_ORIGIN_URL",
  "RAVENOS_SPOT_CHART_ORIGIN_TOKEN",
  "RAVENOS_SPOT_CHART_ORIGIN_URL",
  "COINGECKO_API_KEY",
  "COINGECKO_PRO_API_KEY",
]);

function selectedDotenvValues(path) {
  if (!existsSync(path)) return {};
  const allowed = new Set(PROVIDER_ENV_NAMES);
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    if (!allowed.has(key)) continue;
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function releaseProviderDefaults(repoRoot) {
  const path = join(repoRoot, "config", "release.json");
  if (!existsSync(path)) return {};
  try {
    const provider = JSON.parse(readFileSync(path, "utf8"))?.onchain_chart_provider || {};
    const productionQualified = provider.production_promotion_eligible === true;
    return {
      provider: productionQualified ? provider.production_provider : provider.preview_provider,
      plan: productionQualified ? provider.production_provider_plan : provider.preview_provider_plan,
      commercial: productionQualified
        ? provider.production_provider_commercial
        : provider.preview_provider_commercial,
      productionProvider: provider.production_provider,
      productionQualified,
    };
  } catch {
    return {};
  }
}

export function onchainChartProviderEnv(repoRoot, baseEnv = process.env) {
  const parentEnvPath = baseEnv.RAVEN_APP_ENV_PATH || join(repoRoot, "..", ".env");
  const parentValues = selectedDotenvValues(parentEnvPath);
  const env = { ...baseEnv };
  for (const name of PROVIDER_ENV_NAMES) {
    if (!String(env[name] || "").trim() && String(parentValues[name] || "").trim()) env[name] = parentValues[name];
  }
  if (!String(env.ONCHAIN_CHART_PROVIDER_SECRET || "").trim() && String(env.COINGECKO_API_KEY || "").trim()) {
    const defaults = releaseProviderDefaults(repoRoot);
    env.ONCHAIN_CHART_PROVIDER_SECRET = env.COINGECKO_API_KEY;
    if (!String(env.ONCHAIN_CHART_PROVIDER || "").trim()) env.ONCHAIN_CHART_PROVIDER = defaults.provider || "coingecko";
    if (!String(env.ONCHAIN_CHART_PROVIDER_PLAN || "").trim()) env.ONCHAIN_CHART_PROVIDER_PLAN = defaults.plan || "demo";
    if (!String(env.ONCHAIN_CHART_PROVIDER_COMMERCIAL || "").trim()) {
      env.ONCHAIN_CHART_PROVIDER_COMMERCIAL = String(defaults.commercial === true);
    }
    if (!String(env.RAVENOS_ONCHAIN_CHART_PRODUCTION_PROVIDER || "").trim() && defaults.productionProvider) {
      env.RAVENOS_ONCHAIN_CHART_PRODUCTION_PROVIDER = defaults.productionProvider;
    }
    if (!String(env.RAVENOS_ONCHAIN_CHART_PRODUCTION_QUALIFIED || "").trim()) {
      env.RAVENOS_ONCHAIN_CHART_PRODUCTION_QUALIFIED = defaults.productionQualified ? "1" : "0";
    }
  }
  return env;
}
