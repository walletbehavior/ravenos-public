import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

const routeConfig = JSON.parse(readFileSync("config/public_routes.json", "utf8"));
const releaseConfig = JSON.parse(readFileSync("config/release.json", "utf8"));
const routeList = (routeConfig.routes || []).filter((route) => route.public).map((route) => route.route);
const files = [
  "index.html",
  "opportunity/index.html",
  "replay/index.html",
  "outcomes/index.html",
  "claims/index.html",
  "memory/index.html",
  "behavior/index.html",
  "intelligence/index.html",
  "research/index.html",
  "perps/index.html",
  "chains/solana/index.html",
  "chains/base/index.html",
  "chains/ethereum/index.html",
  "terminal/index.html",
  "discover/index.html",
  "portfolio/index.html",
  "atlas/index.html",
  "docs/index.html",
  "faq/index.html",
  "account/index.html",
  "monitor/index.html",
  "pricing/index.html",
  "privacy/index.html",
  "terms/index.html",
  "public_routes.json",
  "ravenos-route.css",
  "ravenos-route-app.js",
  "ravenos-landing.css",
  "ravenos-landing.js",
  "ravenos-guide.css",
  "ravenos-account.css",
  "ravenos-account.js",
  "ravenos-monitor.css",
  "ravenos-monitor.js",
  "ravenos-shell.css",
  "ravenos-shell.js",
  "ravenos-context-store.js",
  "ravenos-intelligence-contract.js",
  "ravenos-chart-data-plane.js",
  "ravenos-perps-workspace.css",
  "ravenos-perps-workspace.js",
  "ravenos-price-workspace.css",
  "ravenos-price-workspace.js",
  "ravenos-terminal-live.css",
  "ravenos-terminal-live.js",
  "ravenos-workspace.css",
  "ravenos-discover-intelligence.js",
  "ravenos-discover.js",
  "ravenos-portfolio.js",
  "ravenos-atlas.js",
  "ravenos-tradingview-adapter.js",
  "ravenos-evidence.css",
  "ravenos-funnel.css",
  "raven-chart-overlays.js",
  "raven-reads.js",
  "raven-price-chart.js",
  "assets/providers/dexpaprika-symbol.svg",
];

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function safeExec(args) {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function safeGitFile(path) {
  try {
    return execFileSync("git", ["show", `HEAD:${path}`], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function normalizeBuildStampedContent(source) {
  return source
    .replace(/UI build[^<\n]*· artifact[^<\n]*· public evidence shell/g, "Public artifact verified")
    .replace(/Public artifact (?:loading|verified)/g, "Public artifact verified")
    .replace(/window\.__RAVENOS_BUILD_ID__ = "(?:__RAVENOS_BUILD_ID__|[^"]+)";/g, 'window.__RAVENOS_BUILD_ID__ = "__RAVENOS_BUILD_ID__";')
    .replace(/(lightweight-charts\.standalone\.production\.js\?v=)(?:__RAVENOS_BUILD_ID__|[^"'&]+)/g, "$1__RAVENOS_BUILD_ID__")
    .replace(/(raven-chart-overlays\.js\?v=)(?:__RAVENOS_BUILD_ID__|[^"'&]+)/g, "$1__RAVENOS_BUILD_ID__")
    .replace(/(raven-reads\.js\?v=)(?:__RAVENOS_BUILD_ID__|[^"'&]+)/g, "$1__RAVENOS_BUILD_ID__")
    .replace(/(raven-price-chart\.js\?v=)(?:__RAVENOS_BUILD_ID__|[^"'&]+)/g, "$1__RAVENOS_BUILD_ID__")
    .replace(/(ravenos-access\.js\?v=)(?:__RAVENOS_BUILD_ID__|[^"'&]+)/g, "$1__RAVENOS_BUILD_ID__")
    .replace(/(ravenos-price-workspace\.js\?v=)(?:__RAVENOS_BUILD_ID__|[^"'&]+)/g, "$1__RAVENOS_BUILD_ID__")
    .replace(/(ravenos-terminal-review-foundation\.js\?v=)(?:__RAVENOS_BUILD_ID__|[^"'&]+)/g, "$1__RAVENOS_BUILD_ID__")
    .replace(/(ravenos-terminal-trade\.js\?v=)(?:__RAVENOS_BUILD_ID__|[^"'&]+)/g, "$1__RAVENOS_BUILD_ID__");
}

function normalizedFileHash(path) {
  return createHash("sha256").update(normalizeBuildStampedContent(readFileSync(path, "utf8"))).digest("hex");
}

function normalizedContentHash(source) {
  return createHash("sha256").update(normalizeBuildStampedContent(source)).digest("hex");
}

function resolveGitIdentity() {
  const commit = process.env.RAVENOS_PUBLIC_COMMIT || process.env.GITHUB_SHA || safeExec(["rev-parse", "HEAD"]) || "workspace";
  const shortCommit = /^[0-9a-f]{40}$/i.test(commit) ? commit.slice(0, 12) : String(commit).slice(0, 24);
  const status = commit === "workspace" ? "dirty" : safeExec(["status", "--porcelain=v1"]);
  return { commit, shortCommit, prebuildClean: commit !== "workspace" && !status };
}

function buildInputsMatchHead(paths) {
  return paths.every((path) => {
    const current = readFileSync(path, "utf8");
    const committed = safeGitFile(path);
    if (committed === null) return false;
    return normalizedContentHash(current) === normalizedContentHash(committed);
  });
}

const builtAt = new Date().toISOString();
const assetHashes = Object.fromEntries(
  files.map((path) => [path, { path, hash: sha256(path) }]),
);
const normalizedSourceHashes = Object.fromEntries(
  files.map((path) => [path, { path, hash: normalizedFileHash(path) }]),
);
const gitIdentity = resolveGitIdentity();
const cleanBuildInputs = gitIdentity.prebuildClean || (gitIdentity.commit !== "workspace" && buildInputsMatchHead(files));
const dirtyFingerprint = createHash("sha256")
  .update(JSON.stringify(normalizedSourceHashes))
  .digest("hex")
  .slice(0, 8);
const buildId = cleanBuildInputs
  ? gitIdentity.shortCommit
  : `${gitIdentity.shortCommit}-dirty-${dirtyFingerprint}`;

const manifest = {
  public_build_id: buildId,
  public_commit: gitIdentity.shortCommit,
  source_commit: gitIdentity.commit,
  worker_version: process.env.RAVENOS_WORKER_VERSION || null,
  built_at: builtAt,
  deployed_at: null,
  build_identity_mode: cleanBuildInputs ? "git_commit" : "dirty_tree_fingerprint",
  source_tree_state: gitIdentity.prebuildClean ? "clean" : "dirty",
  dirty_tree_fingerprint: cleanBuildInputs ? null : dirtyFingerprint,
  asset_manifest_version: "1.0",
  route_manifest_version: routeConfig.route_manifest_version || "1.0",
  release_contract_version: releaseConfig.release_contract_version || "ravenos.release.v1",
  public_origin_contract_version: releaseConfig.public_origin?.contract_version || "unknown",
  onchain_chart_provider_contract_version: releaseConfig.onchain_chart_provider?.contract_version || "unknown",
  onchain_chart_provider_production_state: releaseConfig.onchain_chart_provider?.production_promotion_eligible === true ? "qualified" : "blocked",
  assets: assetHashes,
  routes: routeList,
  api_schema_versions: {
    evidence_contract: "1.0",
    claim_lineage: "2.0",
    intelligence_contract: "ravenos.intelligence.v1",
    selected_context: "ravenos.context.v2",
    price_workspace: "ravenos.price_workspace.v1",
    chart_candle_series: "ravenos.chart_candle_series.v1",
    chart_capability_registry: "ravenos.chart_capability_registry.v1",
    onchain_chart_provider_registry: "ravenos.onchain_chart_provider_registry.v1",
    hyperliquid_account_snapshot: "ravenos.hyperliquid_account_snapshot.v1",
    hyperliquid_account_scenario: "ravenos.hyperliquid_account_scenario.v1",
    hyperliquid_account_history: "ravenos.hyperliquid_account_history.v1",
  },
  evidence_contract_version: "1.0",
  claim_lineage_version: "2.0",
  artifact_expectation: "public artifacts refresh independently from the UI shell",
  deployment_note: "If this value is absent on ravenos.xyz, the route is serving an older static shell.",
  ui_build: buildId,
};

for (const output of ["ravenos_build.json", "public/ravenos_build.json"]) {
  const target = join(process.cwd(), output);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

console.log(`Generated ravenos_build.json ${buildId}`);
