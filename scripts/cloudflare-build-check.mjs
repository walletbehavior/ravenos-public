import { existsSync, readFileSync } from "node:fs";

const routeConfig = JSON.parse(readFileSync("config/public_routes.json", "utf8"));
const build = JSON.parse(readFileSync("ravenos_build.json", "utf8"));
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const wranglerConfig = readFileSync("wrangler.jsonc", "utf8");
const routes = (routeConfig.routes || []).filter((route) => route.public);
const deployManifestPath = ".deploy-public/ravenos_deploy_manifest.json";

const requiredAssets = [
  "ravenos-route.css",
  "ravenos-route-app.js",
  "ravenos-evidence.css",
  "ravenos-funnel.css",
  "ravenos-terminal-trade.js",
  "ravenos_build.json",
  "public/ravenos-route.css",
  "public/ravenos-route-app.js",
  "public/ravenos-evidence.css",
  "public/ravenos-funnel.css",
  "public/ravenos-terminal-trade.js",
  "public/ravenos_build.json",
  "functions/api/access.js",
  "public/ravenos/brief.json",
  "public/ravenos/replay.json",
  "public/ravenos/outcomes.json",
  "public/ravenos/memory.json",
  "public/ravenos/behavior.json",
  "public/ravenos/research.json",
  "public/ravenos/perps.json",
  "public/ravenos/claims.json",
  "public/ravenos/status.json",
  "public/ravenos/manifest.json",
  "public/ravenos/terminal_health.json",
  "ravenos/brief.json",
  "ravenos/replay.json",
  "ravenos/outcomes.json",
  "ravenos/memory.json",
  "ravenos/behavior.json",
  "ravenos/research.json",
  "ravenos/perps.json",
  "ravenos/claims.json",
  "ravenos/status.json",
  "ravenos/manifest.json",
  "ravenos/terminal_health.json",
  ".deploy-public/ravenos-route.css",
  ".deploy-public/ravenos-route-app.js",
  ".deploy-public/ravenos-evidence.css",
  ".deploy-public/ravenos-funnel.css",
  ".deploy-public/ravenos-terminal-trade.js",
  ".deploy-public/ravenos-access.js",
  ".deploy-public/raven-chart-overlays.js",
  ".deploy-public/raven-price-chart.js",
  ".deploy-public/vendor/lightweight-charts.standalone.production.js",
  ".deploy-public/ravenos_build.json",
  ".deploy-public/public_routes.json",
  ".deploy-public/account/index.html",
  ".deploy-public/pricing/index.html",
  ".deploy-public/pro/index.html",
  ".deploy-public/token/index.html",
  ".deploy-public/upgrade/index.html",
  ".deploy-public/ravenos/brief.json",
  ".deploy-public/ravenos/replay.json",
  ".deploy-public/ravenos/outcomes.json",
  ".deploy-public/ravenos/memory.json",
  ".deploy-public/ravenos/behavior.json",
  ".deploy-public/ravenos/research.json",
  ".deploy-public/ravenos/perps.json",
  ".deploy-public/ravenos/claims.json",
  ".deploy-public/ravenos/status.json",
  ".deploy-public/ravenos/manifest.json",
  ".deploy-public/ravenos/terminal_health.json",
  deployManifestPath,
];

function routeToPath(route) {
  const trimmed = route.replace(/^\/+|\/+$/g, "");
  return trimmed ? `${trimmed}/index.html` : "index.html";
}

const required = [
  ...requiredAssets,
  ...routes.flatMap((route) => {
    const file = routeToPath(route.route);
    return [file, `public/${file}`];
  }),
];

const missing = required.filter((path) => !existsSync(path));
if (missing.length) {
  console.error(`Missing Cloudflare Pages artifacts: ${missing.join(", ")}`);
  process.exit(1);
}

if (!/\"directory\"\s*:\s*\"\.deploy-public\"/.test(wranglerConfig)) {
  console.error('Wrangler assets.directory must point to ".deploy-public"');
  process.exit(1);
}

if (packageJson.engines?.node !== "22.x") {
  console.error('package.json must pin Node 22 via "22.x"');
  process.exit(1);
}

if (packageJson.devDependencies?.wrangler !== "4.104.0") {
  console.error("package.json must pin wrangler 4.104.0 exactly");
  process.exit(1);
}

const deployManifest = JSON.parse(readFileSync(deployManifestPath, "utf8"));
const deployFiles = new Set(deployManifest.files || []);
const forbiddenDeployPrefixes = ["node_modules/", "test-results/", "tests/", "scripts/", "functions/", "migrations/", "public/", ".git/"];
const forbiddenDeployFiles = ["package.json", "package-lock.json", "wrangler.jsonc", "playwright.config.mjs"];
for (const file of deployFiles) {
  if (forbiddenDeployPrefixes.some((prefix) => file.startsWith(prefix)) || forbiddenDeployFiles.includes(file)) {
    console.error(`Deploy package contains forbidden file: ${file}`);
    process.exit(1);
  }
}

if (deployManifest.public_build_id !== build.public_build_id) {
  console.error("Deploy manifest build ID must match ravenos_build.json");
  process.exit(1);
}

for (const route of routes) {
  const file = routeToPath(route.route);
  const rootHtml = readFileSync(file, "utf8");
  const publicHtml = readFileSync(`public/${file}`, "utf8");
  if (rootHtml !== publicHtml) {
    console.error(`Route mismatch: ${file} does not match public/${file}`);
    process.exit(1);
  }
  if (!rootHtml.includes("UI build") && !rootHtml.includes("public evidence shell")) {
    console.error(`Route shell missing build marker placeholder: ${file}`);
    process.exit(1);
  }
  const deployHtml = readFileSync(`.deploy-public/${file}`, "utf8");
  if (rootHtml !== deployHtml) {
    console.error(`Deploy route mismatch: ${file} does not match .deploy-public/${file}`);
    process.exit(1);
  }
}

for (const asset of ["ravenos-route.css", "ravenos-route-app.js", "ravenos-evidence.css", "ravenos-funnel.css", "ravenos-terminal-trade.js", "raven-chart-overlays.js", "raven-price-chart.js", "ravenos_build.json"]) {
  const root = readFileSync(asset, "utf8");
  const pub = readFileSync(`public/${asset}`, "utf8");
  if (root !== pub) {
    console.error(`Asset mismatch: ${asset} does not match public/${asset}`);
    process.exit(1);
  }
  const deploy = readFileSync(`.deploy-public/${asset}`, "utf8");
  if (root !== deploy) {
    console.error(`Deploy asset mismatch: ${asset} does not match .deploy-public/${asset}`);
    process.exit(1);
  }
}

const research = readFileSync("research/index.html", "utf8");
if (/Developer Mode|Loading Structure Lab/.test(research)) {
  console.error("Public Research shell contains stale developer/loading strings");
  process.exit(1);
}

const forbiddenPublicTerms = [
  "WalletMemory",
  "ShadowMirror",
  "Turnkey",
  "treasury",
  "canary",
  "live execution",
  "private wallet",
];

for (const route of routes) {
  const file = routeToPath(route.route);
  const html = readFileSync(file, "utf8");
  const leaked = forbiddenPublicTerms.filter((term) => html.includes(term));
  if (leaked.length) {
    console.error(`Public route contains private terms (${leaked.join(", ")}): ${file}`);
    process.exit(1);
  }
}

if (!build.ui_build || !build.public_build_id || !build.built_at) {
  console.error("Build metadata must include ui_build, public_build_id, and built_at");
  process.exit(1);
}

if (build.evidence_contract_version !== "1.0" || build.claim_lineage_version !== "2.0") {
  console.error("Build metadata must include evidence contract v1 and claim lineage v2");
  process.exit(1);
}

if (build.route_manifest_version !== (routeConfig.route_manifest_version || "1.0")) {
  console.error("Build metadata route manifest version mismatch");
  process.exit(1);
}

const routeSet = new Set(build.routes || []);
for (const route of routes.map((entry) => entry.route)) {
  if (!routeSet.has(route)) {
    console.error(`Build metadata missing route: ${route}`);
    process.exit(1);
  }
}

const outcomesHtml = readFileSync("outcomes/index.html", "utf8");
if (!outcomesHtml.includes("What happened after Raven's earlier reads?") || !outcomesHtml.includes('"slug":"outcomes"')) {
  console.error("Outcomes route shell missing proof-rail hooks");
  process.exit(1);
}

console.log("RavenOS Cloudflare Pages artifacts verified.");
