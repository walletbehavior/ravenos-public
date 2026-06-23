export const COVERAGE_LABELS = new Set([
  "public",
  "indexed",
  "deep_raven",
  "cached",
  "preview",
  "sample",
  "unavailable",
]);

const QUALITY = {
  deep_raven: 100,
  indexed: 84,
  public: 64,
  cached: 48,
  preview: 34,
  sample: 22,
  unavailable: 0,
};

export function normalizeCoverage(input = {}) {
  const raw = String(input.coverage || input.label || "").toLowerCase().replaceAll(" ", "_");
  const label = COVERAGE_LABELS.has(raw) ? raw : inferCoverageLabel(input);
  const isLive = Boolean(input.isLive) && !["cached", "preview", "sample", "unavailable"].includes(label);
  const isCached = Boolean(input.isCached) || label === "cached";
  const isSample = Boolean(input.isSample) || label === "sample" || label === "preview";
  return {
    label,
    provider: String(input.provider || providerForLabel(label)),
    isLive,
    isCached,
    isSample,
    lastUpdated: input.lastUpdated || input.last_updated || "sample",
    warning: warningForCoverage({ ...input, label, isLive, isCached, isSample }),
    dataDepth: String(input.dataDepth || dataDepthForLabel(label)),
    supportedFeatures: Array.isArray(input.supportedFeatures) ? input.supportedFeatures.map(String) : supportedFeaturesForLabel(label),
    qualityScore: QUALITY[label] ?? 0,
  };
}

export function inferCoverageLabel(input = {}) {
  const text = `${input.coverage || ""} ${input.provider || ""} ${input.warning || ""}`.toLowerCase();
  if (input.unavailable || text.includes("unavailable")) return "unavailable";
  if (input.isSample || text.includes("sample")) return "sample";
  if (text.includes("preview")) return "preview";
  if (input.isCached || text.includes("cached") || text.includes("stale")) return "cached";
  if (text.includes("deep")) return "deep_raven";
  if (text.includes("live")) return "indexed";
  if (text.includes("indexed") || text.includes("raven indexed")) return "indexed";
  if (text.includes("public") || text.includes("dexscreener")) return "public";
  return input.isLive ? "indexed" : "preview";
}

function providerForLabel(label) {
  if (label === "public") return "Public provider";
  if (label === "indexed") return "Raven indexed";
  if (label === "deep_raven") return "Deep Raven";
  if (label === "cached") return "Cached prior data";
  if (label === "unavailable") return "Unavailable";
  return "Raven preview";
}

function dataDepthForLabel(label) {
  if (label === "deep_raven") return "deep";
  if (label === "indexed") return "indexed";
  if (label === "public") return "public";
  if (label === "cached") return "stale";
  if (label === "unavailable") return "none";
  return "limited";
}

function supportedFeaturesForLabel(label) {
  if (label === "deep_raven") return ["chart", "overlays", "replay", "participant", "research", "alerts"];
  if (label === "indexed") return ["chart", "overlays", "replay", "alerts"];
  if (label === "public") return ["chart", "basic_overlays", "public_context"];
  if (label === "cached") return ["cached_context"];
  if (label === "unavailable") return [];
  return ["preview_context"];
}

function warningForCoverage(coverage) {
  if (coverage.warning) return String(coverage.warning);
  if (coverage.label === "unavailable") return "Provider unavailable.";
  if (coverage.isSample) return "Sample or preview data. Not live.";
  if (coverage.isCached) return "Cached data. Check stale timestamp.";
  if (!coverage.isLive && ["public", "indexed", "deep_raven"].includes(coverage.label)) return "Coverage is not marked live.";
  return "";
}

export function coverageFromProvider(provider = "", metadata = {}) {
  const name = String(provider || metadata.provider || "").toLowerCase();
  if (name.includes("dexscreener")) return normalizeCoverage({ ...metadata, provider: "Dexscreener", coverage: "public", isLive: false });
  if (name.includes("hyperliquid")) return normalizeCoverage({ ...metadata, provider: "Hyperliquid", coverage: "public", isLive: Boolean(metadata.isLive) });
  if (name.includes("tradier")) return normalizeCoverage({ ...metadata, provider: "Tradier", coverage: metadata.isLive ? "indexed" : "cached" });
  if (name.includes("raven")) return normalizeCoverage({ ...metadata, provider: metadata.provider || "Raven indexed", coverage: metadata.deep ? "deep_raven" : "indexed" });
  return normalizeCoverage(metadata);
}
