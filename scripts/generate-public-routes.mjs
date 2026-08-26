import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const repoRoot = process.cwd();
const config = JSON.parse(readFileSync(join(repoRoot, "config/public_routes.json"), "utf8"));
const routes = config.routes || [];
const clientRouteConfig = {
  route_manifest_version: config.route_manifest_version || "1.0",
  routes: routes.filter((route) => route.public).map(({ source_path: _sourcePath, template: _template, ...route }) => route),
};

function readIfExists(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function routeToPath(route) {
  const trimmed = route.replace(/^\/+|\/+$/g, "");
  return trimmed ? `${trimmed}/index.html` : "index.html";
}

function buildMarkerPlaceholder() {
  return "Public artifact verified";
}

function fallbackArtifactExists(route) {
  if (!route.fallback_artifact) return false;
  const relativePath = route.fallback_artifact.replace(/^\/+/, "");
  return [
    join(repoRoot, "public", relativePath),
    join(repoRoot, relativePath),
  ].some((candidate) => readIfExists(candidate) !== null);
}

function routePrompt(route) {
  if (route.slug === "opportunity") return "What is Raven watching now?";
  if (route.slug === "memory") return "Similar conditions remain mixed";
  if (route.slug === "replay") return "What looked similar before?";
  if (route.slug === "outcomes") return "Did earlier reads follow through?";
  return route.question;
}

function renderGeneratedRoute(route) {
  const hasFallbackArtifact = fallbackArtifactExists(route);
  const prompt = routePrompt(route);
  const configPayload = {
    ...route,
    question: prompt,
    route_manifest_version: config.route_manifest_version,
    fallback_message: hasFallbackArtifact ? null : "Current read forming. Verified fallback data is not yet available for this route.",
    surface_state: "live_intelligence_workspace",
  };
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RavenOS ${route.title}</title>
  <meta name="description" content="${prompt}" />
  <link rel="stylesheet" href="/ravenos-route.css" />
  <link rel="stylesheet" href="/ravenos-evidence.css" />
  <link rel="stylesheet" href="/ravenos-funnel.css" />
  <link rel="stylesheet" href="/ravenos-shell.css" />
</head>
<body>
  <main class="route-shell" data-route-slug="${route.slug}">
    <section class="public-evidence" aria-label="Why this read can change" data-evidence-contract-header>
      <div class="public-evidence-strip">
        <div class="public-evidence-cell"><span>Read</span><strong data-evidence-field="role">Current read</strong></div>
        <div class="public-evidence-cell"><span>Updated</span><strong data-evidence-field="as_of">awaiting read</strong></div>
        <div class="public-evidence-cell"><span>Window</span><strong data-evidence-field="window">read-defined window</strong></div>
        <div class="public-evidence-cell"><span>Observations</span><strong data-evidence-field="sample">see totals below</strong></div>
        <div class="public-evidence-cell"><span>Status</span><strong data-evidence-field="freshness">checking</strong></div>
        <div class="public-evidence-cell"><span>Confidence</span><strong data-evidence-field="confidence">developing</strong></div>
      </div>
      <details class="public-evidence-details">
        <summary>Why this read can change</summary>
        <p class="public-evidence-bridge" data-evidence-field="bridge"><strong>Why reads can differ:</strong> Live reads can move before outcomes settle. We separate current opportunity from later followthrough checks.</p>
        <div class="public-evidence-detail-grid">
          <div>Outcome window<strong data-evidence-field="settlement">pending or not applicable</strong></div>
          <div>Population<strong data-evidence-field="population">aggregate market context</strong></div>
          <div>Authority<strong data-evidence-field="source">Raven feed</strong></div>
          <div>Observed / measured<strong data-evidence-field="observed_settled">0 / 0</strong></div>
          <div>Validation status<strong data-evidence-field="validation">pending</strong></div>
        </div>
      </details>
    </section>

    <section class="route-hero">
      <div class="route-hero-meta"><span class="route-eyebrow">${route.title}</span><div class="route-delivery-state" id="routeDeliveryState" data-state="unavailable"><span>Unavailable</span><strong>Checking current data</strong><small>Timestamp pending</small></div></div>
      <h1 id="routeHeadline">${prompt}</h1>
      <p class="route-summary" id="routeHeroSummary">Current read forming.</p>
      <div class="route-state-strip" id="routeStateStrip">${route.title}</div>
    </section>

    <section class="route-grid">
      <article class="route-panel" id="routePrimaryPanel"></article>
      <article class="route-panel" id="routeSecondaryPanel"></article>
    </section>

    <footer hidden aria-hidden="true"><span id="routeHydrationState">Awaiting current data</span><span id="ravenosBuildMark">${buildMarkerPlaceholder()}</span></footer>
  </main>
  <script id="ravenosRouteConfig" type="application/json">${JSON.stringify(configPayload)}</script>
  <script type="module" src="/ravenos-route-app.js"></script>
</body>
</html>
`;
}

function writeMirrored(path, content) {
  for (const out of [path, join("public", path)]) {
    const target = join(repoRoot, out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
  }
}

for (const route of routes) {
  if (!route.public) continue;
  const htmlPath = routeToPath(route.route);
  if (route.template === "existing") {
    const sourcePath = join(repoRoot, route.source_path || htmlPath);
    const content = readFileSync(sourcePath, "utf8");
    writeMirrored(htmlPath, content);
    continue;
  }
  writeMirrored(htmlPath, renderGeneratedRoute(route));
}

for (const legacyPath of [
  "account/index.html",
  "monitor/index.html",
  "pricing/index.html",
  "pro/index.html",
  "token/index.html",
  "upgrade/index.html",
]) {
  const content = readFileSync(join(repoRoot, legacyPath), "utf8");
  writeMirrored(legacyPath, content);
}

for (const asset of [
  "ravenos-route.css",
  "ravenos-route-app.js",
  "ravenos-landing.css",
  "ravenos-landing.js",
  "ravenos-guide.css",
  "ravenos-account.css",
  "ravenos-account.js",
  "ravenos-monitor.css",
  "ravenos-monitor.js",
  "ravenos-evidence.css",
  "ravenos-funnel.css",
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
  "raven-chart-overlays.js",
  "raven-price-chart.js",
  "assets/providers/dexpaprika-symbol.svg",
]) {
  const source = join(repoRoot, asset);
  const content = readFileSync(source, "utf8");
  writeMirrored(asset, content);
}

const publicRavenRoot = join(repoRoot, "public", "ravenos");
try {
  for (const name of readdirSync(publicRavenRoot)) {
    const source = join(publicRavenRoot, name);
    if (!statSync(source).isFile()) continue;
    const content = readFileSync(source);
    const target = join(repoRoot, "ravenos", name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
} catch {
  // Trust artifacts are copied by sync_public_data.py; the build check will fail if they are absent.
}

writeMirrored("public_routes.json", JSON.stringify(clientRouteConfig, null, 2) + "\n");

console.log(`Generated ${routes.filter((route) => route.public).length} public routes from ${relative(repoRoot, join(repoRoot, "config/public_routes.json"))}`);
