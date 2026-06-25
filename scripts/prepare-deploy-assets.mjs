import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const repoRoot = process.cwd();
const deployRoot = join(repoRoot, ".deploy-public");
const routeConfig = JSON.parse(readFileSync(join(repoRoot, "config/public_routes.json"), "utf8"));
const build = JSON.parse(readFileSync(join(repoRoot, "ravenos_build.json"), "utf8"));

const legacyRouteFiles = [
  "account/index.html",
  "pricing/index.html",
  "pro/index.html",
  "token/index.html",
  "upgrade/index.html",
];

const runtimeAssets = [
  "public_routes.json",
  "ravenos_build.json",
  "ravenos-route.css",
  "ravenos-route-app.js",
  "ravenos-evidence.css",
  "ravenos-funnel.css",
  "ravenos-terminal-trade.js",
  "ravenos-access.js",
  "raven-chart-overlays.js",
  "raven-price-chart.js",
  "vendor/lightweight-charts.standalone.production.js",
];

function routeToPath(route) {
  const trimmed = route.replace(/^\/+|\/+$/g, "");
  return trimmed ? `${trimmed}/index.html` : "index.html";
}

function copyFile(relativePath, copiedFiles) {
  const source = join(repoRoot, relativePath);
  if (!statSync(source).isFile()) {
    throw new Error(`Expected deploy file is missing or not a file: ${relativePath}`);
  }
  const target = join(deployRoot, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
  copiedFiles.add(relativePath);
}

function copyDirectory(relativePath) {
  const source = join(repoRoot, relativePath);
  if (!statSync(source).isDirectory()) {
    throw new Error(`Expected deploy directory is missing or not a directory: ${relativePath}`);
  }
  const target = join(deployRoot, relativePath);
  cpSync(source, target, { recursive: true });
}

function listFiles(root, prefix = "") {
  const current = prefix ? join(root, prefix) : root;
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listFiles(root, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

const canonicalRouteFiles = (routeConfig.routes || [])
  .filter((route) => route.public)
  .map((route) => routeToPath(route.route));

const topLevelRuntimeJson = readdirSync(repoRoot)
  .filter((name) => /^ravenos(?:_|$).+\.json$/.test(name))
  .sort();

const copiedFiles = new Set();
rmSync(deployRoot, { recursive: true, force: true });
mkdirSync(deployRoot, { recursive: true });

for (const file of [...canonicalRouteFiles, ...legacyRouteFiles, ...runtimeAssets, ...topLevelRuntimeJson]) {
  copyFile(file, copiedFiles);
}

for (const dir of ["ravenos", "vendor"]) {
  copyDirectory(dir);
}

const deployManifest = {
  public_build_id: build.public_build_id,
  public_commit: build.public_commit,
  generated_at: new Date().toISOString(),
  asset_directory: ".deploy-public",
  route_manifest_version: routeConfig.route_manifest_version || "1.0",
  files: [...listFiles(deployRoot), "ravenos_deploy_manifest.json"].sort(),
};

writeFileSync(
  join(deployRoot, "ravenos_deploy_manifest.json"),
  `${JSON.stringify(deployManifest, null, 2)}\n`,
  "utf8",
);

console.log(`Prepared ${deployManifest.files.length} deployable public assets in .deploy-public`);
