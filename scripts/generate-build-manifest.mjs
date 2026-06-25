import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

const routeConfig = JSON.parse(readFileSync("config/public_routes.json", "utf8"));
const routeList = (routeConfig.routes || []).filter((route) => route.public).map((route) => route.route);
const files = [
  "index.html",
  "brief/index.html",
  "opportunity/index.html",
  "replay/index.html",
  "outcomes/index.html",
  "claims/index.html",
  "memory/index.html",
  "behavior/index.html",
  "research/index.html",
  "perps/index.html",
  "chains/solana/index.html",
  "chains/base/index.html",
  "chains/ethereum/index.html",
  "terminal/index.html",
  "public_routes.json",
  "ravenos-route.css",
  "ravenos-route-app.js",
  "ravenos-evidence.css",
  "ravenos-funnel.css",
  "ravenos-terminal-trade.js",
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
    .replace(/UI build[^<\n]*· artifact[^<\n]*· public evidence shell/g, "UI build __RAVENOS_BUILD_ID__ · artifact __RAVENOS_BUILT_AT__ · public evidence shell")
    .replace(/window\.__RAVENOS_BUILD_ID__ = "(?:__RAVENOS_BUILD_ID__|[^"]+)";/g, 'window.__RAVENOS_BUILD_ID__ = "__RAVENOS_BUILD_ID__";')
    .replace(/(lightweight-charts\.standalone\.production\.js\?v=)(?:__RAVENOS_BUILD_ID__|[^"'&]+)/g, "$1__RAVENOS_BUILD_ID__")
    .replace(/(raven-chart-overlays\.js\?v=)(?:__RAVENOS_BUILD_ID__|[^"'&]+)/g, "$1__RAVENOS_BUILD_ID__")
    .replace(/(raven-price-chart\.js\?v=)(?:__RAVENOS_BUILD_ID__|[^"'&]+)/g, "$1__RAVENOS_BUILD_ID__")
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
  public_commit: gitIdentity.commit,
  worker_version: process.env.RAVENOS_WORKER_VERSION || null,
  built_at: builtAt,
  deployed_at: null,
  build_identity_mode: cleanBuildInputs ? "git_commit" : "dirty_tree_fingerprint",
  source_tree_state: cleanBuildInputs ? "clean" : "dirty",
  dirty_tree_fingerprint: cleanBuildInputs ? null : dirtyFingerprint,
  asset_manifest_version: "1.0",
  route_manifest_version: routeConfig.route_manifest_version || "1.0",
  assets: assetHashes,
  routes: routeList,
  api_schema_versions: {
    evidence_contract: "1.0",
    claim_lineage: "2.0",
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

const buildMarker = `UI build ${buildId} · artifact ${builtAt} · public evidence shell`;
const routeFiles = routeList.map((route) => {
  const trimmed = route.replace(/^\/+|\/+$/g, "");
  return trimmed ? `${trimmed}/index.html` : "index.html";
});

for (const file of [...routeFiles, ...routeFiles.map((file) => `public/${file}`)]) {
  const source = readFileSync(file, "utf8");
  const updated = source
    .replace(/UI build[^<\n]*· artifact[^<\n]*· public evidence shell/g, buildMarker)
    .replace(/window\.__RAVENOS_BUILD_ID__ = "(?:__RAVENOS_BUILD_ID__|[^"]+)";/g, `window.__RAVENOS_BUILD_ID__ = "${buildId}";`)
    .replace(/(lightweight-charts\.standalone\.production\.js\?v=)(?:__RAVENOS_BUILD_ID__|[^"'&]+)/g, `$1${buildId}`)
    .replace(/(raven-chart-overlays\.js\?v=)(?:__RAVENOS_BUILD_ID__|[^"'&]+)/g, `$1${buildId}`)
    .replace(/(raven-price-chart\.js\?v=)(?:__RAVENOS_BUILD_ID__|[^"'&]+)/g, `$1${buildId}`)
    .replace(/(ravenos-terminal-trade\.js\?v=)(?:__RAVENOS_BUILD_ID__|[^"'&]+)/g, `$1${buildId}`);
  writeFileSync(file, updated, "utf8");
}

console.log(`Generated ravenos_build.json ${buildId}`);
