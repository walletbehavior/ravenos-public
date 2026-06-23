export const COVERAGE = new Set(["Live", "Cached", "Public fallback", "Preview", "Sample", "Unavailable"]);

export function normalizeCoverage(value = "Sample") {
  const text = String(value || "Sample");
  return COVERAGE.has(text) ? text : "Sample";
}

export function coverageMeta({ provider = "sample", coverage = "Sample", lastUpdated = "sample", warning = "" } = {}) {
  const normalized = normalizeCoverage(coverage);
  return {
    provider,
    coverage: normalized,
    isLive: normalized === "Live",
    isCached: normalized === "Cached",
    isSample: normalized === "Sample" || normalized === "Preview",
    lastUpdated,
    warning,
  };
}

export function resolveProviderFallback({ domain = "crypto_spot", raven = null, dexscreener = null, cache = null, sample = null, tradier = null } = {}) {
  if ((domain === "crypto_spot" || domain === "perps") && raven) return coverageMeta({ provider: "Raven indexed", coverage: "Live", lastUpdated: raven.lastUpdated || "live" });
  if (domain === "crypto_spot" && dexscreener) return coverageMeta({ provider: "Dexscreener", coverage: "Public fallback", lastUpdated: dexscreener.lastUpdated || "public", warning: "Limited public coverage" });
  if (domain === "perps" && dexscreener) return coverageMeta({ provider: "Public pressure fallback", coverage: "Public fallback", lastUpdated: dexscreener.lastUpdated || "public", warning: "Public pressure approximation" });
  if ((domain === "equities" || domain === "etfs" || domain === "options" || domain === "macro") && tradier) return coverageMeta({ provider: "Tradier", coverage: "Live", lastUpdated: tradier.lastUpdated || "live" });
  if (cache) return coverageMeta({ provider: cache.provider || "Cached prior data", coverage: "Cached", lastUpdated: cache.lastUpdated || "stale", warning: cache.warning || "Using cached prior data" });
  if (sample) return coverageMeta({ provider: sample.provider || "Sample model", coverage: domain === "crypto_spot" || domain === "perps" ? "Sample" : "Preview", lastUpdated: "sample", warning: sample.warning || "Sample data" });
  return coverageMeta({ provider: "Unavailable", coverage: "Unavailable", lastUpdated: "unavailable", warning: "Provider unavailable" });
}

export function coverageLabel(meta = {}) {
  const normalized = coverageMeta(meta);
  return `${normalized.coverage}${normalized.warning ? ` - ${normalized.warning}` : ""}`;
}
