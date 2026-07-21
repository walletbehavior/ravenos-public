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
  "ravenos-evidence.css",
  "ravenos-funnel.css",
  "raven-chart-overlays.js",
  "raven-reads.js",
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

function writeBoundedClaimsProjection(relativePath, copiedFiles) {
  const source = join(repoRoot, relativePath);
  const target = join(deployRoot, relativePath);
  const payload = JSON.parse(readFileSync(source, "utf8"));
  const data = payload.data || {};
  const currentClaimIds = new Set((data.current_claims || []).map((claim) => claim.claim_id).filter(Boolean));
  const recentClaimIds = new Set((data.recent_raven_reads || []).map((claim) => claim.claim_id).filter(Boolean));
  const keepClaim = (row) => row && (currentClaimIds.has(row.claim_id) || recentClaimIds.has(row.claim_id));
  const cap = (rows, limit) => (Array.isArray(rows) ? rows.slice(0, limit) : []);
  const bounded = {
    ...payload,
    deploy_projection: "bounded_claims_public_asset_v1",
    data: {
      ...data,
      claim_history: [
        ...cap(data.claim_history, 80),
        ...cap(data.claim_history, 500).filter(keepClaim),
      ].filter((row, index, arr) => row?.claim_id && arr.findIndex((item) => item.claim_id === row.claim_id) === index),
      claim_observations: [
        ...cap(data.claim_observations, 500),
        ...cap(data.claim_observations, 2000).filter(keepClaim),
      ],
      claim_settlements: [
        ...cap(data.claim_settlements, 500),
        ...cap(data.claim_settlements, 2000).filter(keepClaim),
      ],
      legacy_unlinked: cap(data.legacy_unlinked, 80),
      deploy_projection_limits: {
        claim_history: 80,
        claim_observations: 500,
        claim_settlements: 500,
        legacy_unlinked: 80,
        note: "Full append-only lineage remains in origin/runtime artifacts; deploy asset is bounded for Cloudflare Workers asset limits.",
      },
    },
  };
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(bounded)}\n`, "utf8");
  copiedFiles.add(relativePath);
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

const publicFallbackArtifacts = [
  "brief.json",
  "replay.json",
  "outcomes.json",
  "memory.json",
  "behavior.json",
  "research.json",
  "perps.json",
  "opportunities.json",
  "status.json",
  "terminal_health.json",
];

const copiedFiles = new Set();
rmSync(deployRoot, { recursive: true, force: true });
mkdirSync(deployRoot, { recursive: true });

for (const file of [...canonicalRouteFiles, ...legacyRouteFiles, ...runtimeAssets]) {
  copyFile(file, copiedFiles);
}

for (const file of publicFallbackArtifacts) {
  copyFile(`ravenos/${file}`, copiedFiles);
}
copyDirectory("vendor");
writeBoundedClaimsProjection("ravenos/claims.json", copiedFiles);

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
