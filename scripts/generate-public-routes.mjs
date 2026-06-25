import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const repoRoot = process.cwd();
const config = JSON.parse(readFileSync(join(repoRoot, "config/public_routes.json"), "utf8"));
const routes = config.routes || [];

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

function navLinks(activeSlug) {
  return routes
    .filter((route) => route.public && route.slug !== "home")
    .map((route) => `<a class="${route.slug === activeSlug ? "active" : ""}" href="${route.route}">${route.title}</a>`)
    .join("");
}

function buildMarkerPlaceholder() {
  return "UI build pending · artifact pending · public evidence shell";
}

function fallbackPayload(route) {
  if (!route.fallback_artifact) return null;
  const relativePath = route.fallback_artifact.replace(/^\/+/, "");
  const candidates = [
    join(repoRoot, "public", relativePath),
    join(repoRoot, relativePath),
  ];
  for (const candidate of candidates) {
    const text = readIfExists(candidate);
    if (!text) continue;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  return null;
}

function renderGeneratedRoute(route) {
  const payload = fallbackPayload(route);
  const configPayload = {
    ...route,
    route_manifest_version: config.route_manifest_version,
    fallback_payload: payload,
    fallback_message: payload ? null : "Current read forming. Verified fallback data is not yet available for this route.",
  };
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RavenOS ${route.title}</title>
  <meta name="description" content="${route.question}" />
  <link rel="stylesheet" href="/ravenos-route.css" />
  <link rel="stylesheet" href="/ravenos-evidence.css" />
  <link rel="stylesheet" href="/ravenos-funnel.css" />
</head>
<body>
  <main class="route-shell" data-route-slug="${route.slug}">
    <header class="route-topbar">
      <div class="route-brand">
        <span class="route-eyebrow">RavenOS ${route.title}</span>
        <strong>${route.question}</strong>
      </div>
      <nav class="route-nav" aria-label="Primary navigation">${navLinks(route.slug)}</nav>
    </header>

    <section class="public-evidence" aria-label="Public evidence contract" data-evidence-contract-header>
      <div class="public-evidence-strip">
        <div class="public-evidence-cell"><span>Evidence Role</span><strong data-evidence-field="role">${route.evidence_role}</strong></div>
        <div class="public-evidence-cell"><span>As Of</span><strong data-evidence-field="as_of">awaiting read</strong></div>
        <div class="public-evidence-cell"><span>Window</span><strong data-evidence-field="window">declared by read</strong></div>
        <div class="public-evidence-cell"><span>Usable Sample</span><strong data-evidence-field="sample">sample forming</strong></div>
        <div class="public-evidence-cell"><span>Freshness</span><strong data-evidence-field="freshness">checking</strong></div>
        <div class="public-evidence-cell"><span>Confidence</span><strong data-evidence-field="confidence">developing</strong></div>
      </div>
      <div class="public-evidence-bridge" data-evidence-field="bridge"><strong>Evidence bridge:</strong> Current reads, historical context, and settled validation use declared windows so differences can be understood rather than treated as contradictions.</div>
      <details class="public-evidence-details">
        <summary>Evidence details</summary>
        <div class="public-evidence-detail-grid">
          <div>Settlement window<strong data-evidence-field="settlement">pending or not applicable</strong></div>
          <div>Population<strong data-evidence-field="population">public aggregate market context</strong></div>
          <div>Weighting<strong data-evidence-field="weighting">equal row</strong></div>
          <div>Source<strong data-evidence-field="source">verified Raven feed</strong></div>
          <div>Observed / settled<strong data-evidence-field="observed_settled">0 / 0</strong></div>
          <div>Validation status<strong data-evidence-field="validation">pending</strong></div>
          <div>Artifact version<strong data-evidence-field="artifact">unversioned</strong></div>
          <div>Methodology<strong><a href="https://github.com/walletbehavior/ravenos-public/tree/main/docs" target="_blank" rel="noopener noreferrer">Public definitions</a></strong></div>
        </div>
      </details>
    </section>

    <section class="route-hero">
      <span class="route-eyebrow">${route.funnel_stage}</span>
      <h1 id="routeHeadline">${route.question}</h1>
      <p class="route-summary" id="routeHeroSummary">Current read forming.</p>
      <div class="route-state-strip" id="routeStateStrip">${route.title}</div>
    </section>

    <section class="route-grid">
      <article class="route-panel" id="routePrimaryPanel"></article>
      <article class="route-panel" id="routeSecondaryPanel"></article>
    </section>

    <section class="raven-funnel-grid" aria-label="RavenOS intelligence funnel" style="margin-top:16px;">
      <article class="raven-funnel-card"><span class="raven-funnel-stage">${route.funnel_stage}</span><h3>${route.question}</h3><p>Conclusion first, evidence second, methodology expandable.</p></article>
      <article class="raven-funnel-card"><span class="raven-funnel-stage">Validate</span><h3>Outcomes Proof Rail</h3><p>Every material public read should link to later validation, mixed results, or insufficient evidence.</p></article>
      <article class="raven-funnel-card"><span class="raven-funnel-stage">Investigate</span><h3>Next Step</h3><p>Open ${route.next_route === "/terminal/" ? "Terminal" : "Opportunity"} as the next investigative surface.</p></article>
    </section>

    <footer class="route-build">
      <div id="routeHydrationState">Fallback shell loaded</div>
      <div id="ravenosBuildMark">${buildMarkerPlaceholder()}</div>
    </footer>
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
    const publicTarget = join(repoRoot, "public", htmlPath);
    mkdirSync(dirname(publicTarget), { recursive: true });
    writeFileSync(publicTarget, content, "utf8");
    continue;
  }
  writeMirrored(htmlPath, renderGeneratedRoute(route));
}

for (const asset of ["ravenos-route.css", "ravenos-route-app.js", "ravenos-evidence.css", "ravenos-funnel.css"]) {
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

writeMirrored("public_routes.json", JSON.stringify(config, null, 2) + "\n");

console.log(`Generated ${routes.filter((route) => route.public).length} public routes from ${relative(repoRoot, join(repoRoot, "config/public_routes.json"))}`);
