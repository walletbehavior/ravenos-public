import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const routeConfig = JSON.parse(readFileSync("config/public_routes.json", "utf8"));
const releaseConfig = JSON.parse(readFileSync("config/release.json", "utf8"));
const build = JSON.parse(readFileSync("ravenos_build.json", "utf8"));
const deployBuild = JSON.parse(readFileSync(".deploy-public/ravenos_build.json", "utf8"));
const release = JSON.parse(readFileSync(".deploy-public/ravenos_release.json", "utf8"));
const assetManifest = JSON.parse(readFileSync(".deploy-public/ravenos_asset_manifest.json", "utf8"));
const deployManifest = JSON.parse(readFileSync(".deploy-public/ravenos_deploy_manifest.json", "utf8"));
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const wranglerConfig = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
const routes = (routeConfig.routes || []).filter((route) => route.public);

const sourceAssets = [
  "ravenos-route.css",
  "ravenos-route-app.js",
  "ravenos-landing.css",
  "ravenos-landing.js",
  "ravenos-guide.css",
  "ravenos-monitor.css",
  "ravenos-monitor.js",
  "ravenos-wallet-copy.css",
  "ravenos-wallet-copy.js",
  "ravenos-pro-intelligence.css",
  "ravenos-pro-intelligence.js",
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
  "ravenos-discover.css",
  "ravenos-discover-intelligence.js",
  "ravenos-discover.js",
  "ravenos-portfolio.js",
  "ravenos-atlas.js",
  "ravenos-tradingview-adapter.js",
  "ravenos-terminal-review-foundation.js",
  "ravenos-terminal-trade.js",
  "ravenos-access.js",
  "ravenos-evidence.css",
  "ravenos-funnel.css",
  "raven-chart-overlays.js",
  "raven-reads.js",
  "raven-price-chart.js",
  "assets/providers/dexpaprika-symbol.svg",
  "vendor/lightweight-charts.standalone.production.js",
];

const fallbackAssets = [
  "brief.json",
  "replay.json",
  "outcomes.json",
  "memory.json",
  "behavior.json",
  "research.json",
  "perps.json",
  "opportunities.json",
  "claims.json",
  "status.json",
  "terminal_health.json",
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function shaFile(path) {
  return sha256(readFileSync(path));
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableObject(value));
}

function routeToPath(route) {
  const trimmed = route.replace(/^\/+|\/+$/g, "");
  return trimmed ? `${trimmed}/index.html` : "index.html";
}

function listFiles(root, prefix = "") {
  const current = prefix ? join(root, prefix) : root;
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(root, relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

const required = [
  "config/public_routes.json",
  "config/release.json",
  "ravenos_build.json",
  "public/ravenos_build.json",
  "public_routes.json",
  "monitor/index.html",
  "public/monitor/index.html",
  ".deploy-public/monitor/index.html",
  "account/copy/index.html",
  "public/account/copy/index.html",
  ".deploy-public/account/copy/index.html",
  "account/intelligence/index.html",
  "public/account/intelligence/index.html",
  ".deploy-public/account/intelligence/index.html",
  ...sourceAssets,
  ...sourceAssets.map((asset) => `public/${asset}`),
  ...fallbackAssets.flatMap((asset) => [`ravenos/${asset}`, `public/ravenos/${asset}`, `.deploy-public/ravenos/${asset}`]),
  ...routes.flatMap((route) => {
    const file = routeToPath(route.route);
    return [file, `public/${file}`, `.deploy-public/${file}`];
  }),
  ".deploy-public/_headers",
  ".deploy-public/ravenos_release.json",
  ".deploy-public/ravenos_asset_manifest.json",
  ".deploy-public/ravenos_build.json",
  ".deploy-public/ravenos_deploy_manifest.json",
];
const missing = required.filter((path) => !existsSync(path));
if (missing.length) fail(`Missing Cloudflare release artifacts: ${missing.join(", ")}`);

if (wranglerConfig.assets?.directory !== ".deploy-public") fail('Wrangler assets.directory must point to ".deploy-public"');
if (wranglerConfig.assets?.run_worker_first !== true) fail("Wrangler must run the release-cohesion Worker before every asset");
if (wranglerConfig.preview_urls !== true) fail("Version preview URLs must be enabled for isolated release staging");
if (wranglerConfig.keep_vars !== true) fail("Wrangler must preserve existing server bindings and variables");
if (wranglerConfig.version_metadata?.binding !== "CF_VERSION_METADATA") fail("Worker version metadata binding is required");
if (packageJson.engines?.node !== "22.x") fail('package.json must pin Node 22 via "22.x"');
if (packageJson.devDependencies?.wrangler !== "4.104.0") fail("package.json must pin wrangler 4.104.0 exactly");

if (release.schema_version !== releaseConfig.release_contract_version) fail("Release schema version mismatch");
if (assetManifest.schema_version !== releaseConfig.asset_manifest_version) fail("Static asset schema version mismatch");
if (deployManifest.schema_version !== releaseConfig.deploy_manifest_version) fail("Deploy manifest schema version mismatch");
for (const payload of [assetManifest, deployManifest, deployBuild]) {
  if (payload.release_id !== release.release_id) fail("Release identity differs across generated manifests");
  if (payload.source_commit !== release.source_commit) fail("Source commit differs across generated manifests");
  if (payload.static_asset_manifest_sha256 !== release.static_asset_manifest_sha256) {
    fail("Static asset manifest digest differs across generated manifests");
  }
}
if (release.source_commit !== build.source_commit) fail("Release source commit must match build source commit");
if (release.public_build_id !== build.public_build_id || deployBuild.public_build_id !== build.public_build_id) {
  fail("Public build ID differs across generated manifests");
}
if (release.public_origin_contract_version !== releaseConfig.public_origin?.contract_version) {
  fail("Public-origin contract version mismatch");
}
if (
  !Number.isInteger(releaseConfig.public_origin?.request_timeout_ms)
  || releaseConfig.public_origin.request_timeout_ms < 5_000
  || releaseConfig.public_origin.request_timeout_ms > 10_000
) fail("Public-origin request timeout must remain between 5 and 10 seconds");
if (!release.fail_closed || release.signing_enabled || release.submission_enabled) {
  fail("Release safety boundary must remain fail-closed and non-signing");
}

const staticAssetCore = {
  schema_version: assetManifest.schema_version,
  assets: assetManifest.assets,
};
if (sha256(stableJson(staticAssetCore)) !== assetManifest.static_asset_manifest_sha256) {
  fail("Static asset manifest digest is invalid");
}

const manifestUrls = new Set();
for (const [logicalPath, entry] of Object.entries(assetManifest.assets || {})) {
  if (logicalPath !== entry.logical_path) fail(`Static asset logical path mismatch: ${logicalPath}`);
  if (!/^assets\/.+\.[0-9a-f]{16}\.(?:js|css|svg)$/.test(entry.path || "")) {
    fail(`Static asset is not content-addressed: ${entry.path || logicalPath}`);
  }
  const target = `.deploy-public/${entry.path}`;
  if (!existsSync(target) || !statSync(target).isFile()) fail(`Static asset is missing: ${entry.path}`);
  if (shaFile(target) !== entry.sha256) fail(`Static asset hash mismatch: ${entry.path}`);
  if (statSync(target).size !== entry.bytes) fail(`Static asset size mismatch: ${entry.path}`);
  if (entry.url !== `/${entry.path}`) fail(`Static asset URL mismatch: ${entry.path}`);
  manifestUrls.add(entry.url);
}

const deployFiles = listFiles(".deploy-public").sort();
for (const file of deployFiles) {
  if (/\.(?:js|css|svg)$/.test(file) && !/^assets\/.+\.[0-9a-f]{16}\.(?:js|css|svg)$/.test(file)) {
    fail(`Unhashed runtime asset is deployable: ${file}`);
  }
}

for (const route of routes) {
  const file = routeToPath(route.route);
  const rootHtml = readFileSync(file, "utf8");
  const publicHtml = readFileSync(`public/${file}`, "utf8");
  const deployHtml = readFileSync(`.deploy-public/${file}`, "utf8");
  if (rootHtml !== publicHtml) fail(`Route mismatch: ${file} does not match public/${file}`);
  if (route.template !== "existing" && !rootHtml.includes("Public artifact verified")) {
    fail(`Route shell missing stable build marker: ${file}`);
  }
  if (!deployHtml.includes(`name="ravenos-release-id" content="${release.release_id}"`)) {
    fail(`Deploy route missing release identity: ${file}`);
  }
  if (!deployHtml.includes(`data-ravenos-release-id="${release.release_id}"`)) {
    fail(`Deploy route missing release data attribute: ${file}`);
  }
  const references = [...deployHtml.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css|svg))(?:\?[^"']*)?["']/g)].map((match) => match[1]);
  for (const reference of references) {
    if (!manifestUrls.has(reference)) fail(`Route references an unmanifested asset (${reference}): ${file}`);
  }
}

for (const asset of sourceAssets) {
  if (readFileSync(asset, "utf8") !== readFileSync(`public/${asset}`, "utf8")) {
    fail(`Source asset mismatch: ${asset} does not match public/${asset}`);
  }
}

const forbiddenDeployPrefixes = ["node_modules/", "test-results/", "tests/", "scripts/", "functions/", "migrations/", "public/", ".git/"];
const forbiddenDeployFiles = ["package.json", "package-lock.json", "wrangler.jsonc", "playwright.config.mjs"];
for (const file of deployManifest.files || []) {
  if (forbiddenDeployPrefixes.some((prefix) => file.startsWith(prefix)) || forbiddenDeployFiles.includes(file)) {
    fail(`Deploy package contains forbidden file: ${file}`);
  }
}

const expectedHashedFiles = deployFiles.filter((file) => file !== "ravenos_deploy_manifest.json");
const declaredHashedFiles = Object.keys(deployManifest.file_hashes || {}).sort();
if (JSON.stringify(expectedHashedFiles) !== JSON.stringify(declaredHashedFiles)) {
  fail("Deploy manifest file set does not match the staged artifact");
}
for (const file of declaredHashedFiles) {
  if (shaFile(`.deploy-public/${file}`) !== deployManifest.file_hashes[file]) {
    fail(`Deploy manifest file hash mismatch: ${file}`);
  }
}
if (sha256(stableJson(deployManifest.file_hashes)) !== deployManifest.artifact_content_sha256) {
  fail("Deploy artifact content digest is invalid");
}

const headers = readFileSync(".deploy-public/_headers", "utf8");
if (!/\/assets\/\*[\s\S]*max-age=31536000, immutable/.test(headers)) fail("Hashed assets must be immutable");
for (const file of ["ravenos_release.json", "ravenos_asset_manifest.json", "ravenos_build.json", "ravenos_deploy_manifest.json"]) {
  if (!new RegExp(`/${file.replace(".", "\\.")}[\\s\\S]*Cache-Control: no-store`).test(headers)) {
    fail(`Release control document must be no-store: ${file}`);
  }
}

const research = readFileSync("research/index.html", "utf8");
if (/Developer Mode|Loading Structure Lab/.test(research)) fail("Public Research shell contains stale developer/loading strings");
const forbiddenPublicTerms = ["WalletMemory", "ShadowMirror", "Turnkey", "treasury", "canary", "live execution", "private wallet"];
for (const route of routes) {
  const file = routeToPath(route.route);
  const html = readFileSync(file, "utf8");
  const leaked = forbiddenPublicTerms.filter((term) => html.includes(term));
  if (leaked.length) fail(`Public route contains private terms (${leaked.join(", ")}): ${file}`);
}

const forbiddenMonitorCopy = [
  "Authenticated workspace",
  "dormant Raven Monitor",
  "Permission boundary",
  "Research monitoring only",
  "on this release",
];
for (const file of ["monitor/index.html", "public/monitor/index.html", ".deploy-public/monitor/index.html"]) {
  const html = readFileSync(file, "utf8");
  const leaked = forbiddenMonitorCopy.filter((term) => html.toLowerCase().includes(term.toLowerCase()));
  if (leaked.length) fail(`Saved markets contains internal product copy (${leaked.join(", ")}): ${file}`);
}

const customerCopyGuards = new Map([
  [["intelligence/index.html", "public/intelligence/index.html", ".deploy-public/intelligence/index.html"], ["Aggregate · privacy-safe", "Freshness-gated", "public evidence contract", "Identity and evidence boundary"]],
  [["terminal/index.html", "public/terminal/index.html", ".deploy-public/terminal/index.html"], ["Provider-listed pools can resolve", "independently verified"]],
  [["ravenos-shell.js", "public/ravenos-shell.js", `.deploy-public/${assetManifest.assets?.["ravenos-shell.js"]?.path || "missing-ravenos-shell.js"}`], ["Account activation status"]],
  [["account/index.html", "public/account/index.html", ".deploy-public/account/index.html"], ["Next security stage", "Read-only beta"]],
  [["ravenos-account.js", "public/ravenos-account.js", `.deploy-public/${assetManifest.assets?.["ravenos-account.js"]?.path || "missing-ravenos-account.js"}`], ["Secure activation pending", "Portfolio Preview"]],
]);
for (const [files, terms] of customerCopyGuards) {
  for (const file of files) {
    const contents = readFileSync(file, "utf8");
    const leaked = terms.filter((term) => contents.toLowerCase().includes(term.toLowerCase()));
    if (leaked.length) fail(`Customer surface contains internal product copy (${leaked.join(", ")}): ${file}`);
  }
}

if (!build.ui_build || !build.public_build_id || !build.built_at || !build.source_commit) {
  fail("Build metadata must include UI, public build, timestamp, and full source commit identity");
}
if (build.evidence_contract_version !== "1.0" || build.claim_lineage_version !== "2.0") {
  fail("Build metadata must include evidence contract v1 and claim lineage v2");
}
if (build.route_manifest_version !== (routeConfig.route_manifest_version || "1.0")) fail("Build route manifest version mismatch");
const routeSet = new Set(build.routes || []);
for (const route of routes.map((entry) => entry.route)) {
  if (!routeSet.has(route)) fail(`Build metadata missing route: ${route}`);
}

const outcomesHtml = readFileSync("outcomes/index.html", "utf8");
if (!outcomesHtml.includes("Did earlier reads follow through?") || !outcomesHtml.includes('"slug":"outcomes"')) {
  fail("Outcomes route shell missing followthrough hooks");
}

console.log(`RavenOS immutable release ${release.release_id} verified.`);
