import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, posix } from "node:path";

const repoRoot = process.cwd();
const deployRoot = join(repoRoot, ".deploy-public");
const routeConfig = JSON.parse(readFileSync(join(repoRoot, "config/public_routes.json"), "utf8"));
const releaseConfig = JSON.parse(readFileSync(join(repoRoot, "config/release.json"), "utf8"));
const build = JSON.parse(readFileSync(join(repoRoot, "ravenos_build.json"), "utf8"));

const legacyRouteFiles = [
  "account/index.html",
  "pricing/index.html",
  "pro/index.html",
  "token/index.html",
  "upgrade/index.html",
];

const runtimeAssets = [
  "ravenos-route.css",
  "ravenos-route-app.js",
  "ravenos-landing.css",
  "ravenos-landing.js",
  "ravenos-guide.css",
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
  "vendor/lightweight-charts.standalone.production.js",
];

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

function ensureFile(relativePath) {
  const source = join(repoRoot, relativePath);
  if (!statSync(source).isFile()) {
    throw new Error(`Expected deploy file is missing or not a file: ${relativePath}`);
  }
  return source;
}

function copyFile(relativePath) {
  const source = ensureFile(relativePath);
  const target = join(deployRoot, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
}

function writeJson(relativePath, payload) {
  const target = join(deployRoot, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeBoundedClaimsProjection(relativePath) {
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
      ].filter((row, index, rows) => row?.claim_id && rows.findIndex((item) => item.claim_id === row.claim_id) === index),
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

function assetFileName(logicalPath, hash) {
  const extension = extname(logicalPath);
  const stem = logicalPath.slice(0, -extension.length).replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `assets/${stem}.${hash.slice(0, 16)}${extension}`;
}

const sourceAssetSet = new Set(runtimeAssets);
const compiledAssets = new Map();
const compiling = new Set();

function resolveLocalAsset(importer, specifier) {
  const clean = String(specifier || "").split("?", 1)[0];
  const candidate = clean.startsWith("/")
    ? clean.replace(/^\/+/, "")
    : posix.normalize(posix.join(posix.dirname(importer), clean));
  return sourceAssetSet.has(candidate) ? candidate : null;
}

function compileAsset(logicalPath) {
  if (compiledAssets.has(logicalPath)) return compiledAssets.get(logicalPath);
  if (compiling.has(logicalPath)) throw new Error(`Static module cycle cannot be fingerprinted: ${logicalPath}`);
  compiling.add(logicalPath);
  const sourcePath = ensureFile(logicalPath);
  let content = readFileSync(sourcePath, "utf8");
  const extension = extname(logicalPath);
  const dependencies = new Set();

  if (extension === ".js") {
    content = content.replace(/(["'])((?:\/|\.\.?\/)[^"'\s]+\.(?:js|svg))(?:\?[^"'\s]*)?\1/g, (match, quote, specifier) => {
      const dependency = resolveLocalAsset(logicalPath, specifier);
      if (!dependency) return match;
      dependencies.add(dependency);
      const compiled = compileAsset(dependency);
      return `${quote}/${compiled.path}${quote}`;
    });
  }

  const hash = sha256(content);
  const outputPath = assetFileName(logicalPath, hash);
  const output = {
    logical_path: logicalPath,
    path: outputPath,
    url: `/${outputPath}`,
    sha256: hash,
    bytes: Buffer.byteLength(content),
    type: extension === ".css" ? "style" : extension === ".js" ? "script" : extension === ".svg" ? "image" : "asset",
    dependencies: [...dependencies].sort(),
    content,
  };
  compiledAssets.set(logicalPath, output);
  compiling.delete(logicalPath);
  return output;
}

function rewriteHtmlAssets(source, assetMap) {
  let content = source;
  for (const [logicalPath, entry] of Object.entries(assetMap)) {
    const logicalUrl = `/${logicalPath}`;
    const escaped = logicalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    content = content.replace(new RegExp(`${escaped}\\?v=[^"'\\s>]+`, "g"), entry.url);
    content = content.replaceAll(`"${logicalUrl}"`, `"${entry.url}"`);
    content = content.replaceAll(`'${logicalUrl}'`, `'${entry.url}'`);
  }
  return content;
}

function stampReleaseHtml(source, releaseId, buildId) {
  let content = source;
  if (!content.includes('name="ravenos-release-id"')) {
    content = content.replace(
      /(<meta charset="[^"]+"\s*\/?>)/i,
      `$1\n  <meta name="ravenos-release-id" content="${releaseId}" />`,
    );
  }
  content = content.replace(/<html(?![^>]*data-ravenos-release-id)/i, `<html data-ravenos-release-id="${releaseId}"`);
  content = content.replace(
    /window\.__RAVENOS_BUILD_ID__ = "(?:__RAVENOS_BUILD_ID__|[^"]+)";/g,
    `window.__RAVENOS_BUILD_ID__ = "${buildId}";`,
  );
  return content;
}

const canonicalRouteFiles = (routeConfig.routes || [])
  .filter((route) => route.public)
  .map((route) => routeToPath(route.route));

rmSync(deployRoot, { recursive: true, force: true });
mkdirSync(deployRoot, { recursive: true });

for (const file of [...canonicalRouteFiles, ...legacyRouteFiles, "public_routes.json", "ravenos_build.json"]) {
  copyFile(file);
}
for (const file of publicFallbackArtifacts) copyFile(`ravenos/${file}`);
writeBoundedClaimsProjection("ravenos/claims.json");

for (const logicalPath of runtimeAssets) compileAsset(logicalPath);
const assetMap = Object.fromEntries(
  [...compiledAssets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([logicalPath, entry]) => [logicalPath, {
      logical_path: logicalPath,
      path: entry.path,
      url: entry.url,
      sha256: entry.sha256,
      bytes: entry.bytes,
      type: entry.type,
      dependencies: entry.dependencies,
    }]),
);
for (const entry of compiledAssets.values()) {
  const target = join(deployRoot, entry.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, entry.content, "utf8");
}

const staticAssetCore = {
  schema_version: releaseConfig.asset_manifest_version || "ravenos.static_assets.v1",
  assets: assetMap,
};
const staticAssetManifestSha256 = sha256(stableJson(staticAssetCore));
const publicOriginEndpoints = stableObject(releaseConfig.public_origin?.required_endpoints || {});
const publicOriginEndpointContractSha256 = sha256(stableJson(publicOriginEndpoints));

const releaseSeedFiles = Object.fromEntries(listFiles(deployRoot).sort().map((file) => [file, shaFile(join(deployRoot, file))]));
const releaseContentSeedSha256 = sha256(stableJson({
  source_commit: build.source_commit || build.public_commit,
  public_build_id: build.public_build_id,
  static_asset_manifest_sha256: staticAssetManifestSha256,
  public_origin_contract_version: releaseConfig.public_origin?.contract_version,
  public_origin_endpoint_contract_sha256: publicOriginEndpointContractSha256,
  files: releaseSeedFiles,
}));
const sourceCommit = String(build.source_commit || build.public_commit || "workspace");
const commitLabel = sourceCommit.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "workspace";
const releaseId = `ravenos-${commitLabel}-${releaseContentSeedSha256.slice(0, 16)}`;

for (const file of [...canonicalRouteFiles, ...legacyRouteFiles]) {
  const target = join(deployRoot, file);
  const rewritten = stampReleaseHtml(
    rewriteHtmlAssets(readFileSync(target, "utf8"), assetMap),
    releaseId,
    build.public_build_id,
  );
  writeFileSync(target, rewritten, "utf8");
}

const releaseManifest = {
  schema_version: releaseConfig.release_contract_version || "ravenos.release.v1",
  release_id: releaseId,
  source_commit: sourceCommit,
  source_tree_state: build.source_tree_state,
  public_build_id: build.public_build_id,
  built_at: build.built_at,
  release_content_seed_sha256: releaseContentSeedSha256,
  static_asset_manifest_sha256: staticAssetManifestSha256,
  public_origin_contract_version: releaseConfig.public_origin?.contract_version || "unknown",
  public_origin_endpoint_contract_sha256: publicOriginEndpointContractSha256,
  public_origin_required_endpoints: publicOriginEndpoints,
  fail_closed: true,
  signing_enabled: false,
  submission_enabled: false,
};

const assetManifest = {
  ...staticAssetCore,
  release_id: releaseId,
  source_commit: sourceCommit,
  static_asset_manifest_sha256: staticAssetManifestSha256,
};

const deployBuild = {
  ...build,
  release_id: releaseId,
  source_commit: sourceCommit,
  release_contract_version: releaseManifest.schema_version,
  static_asset_manifest_sha256: staticAssetManifestSha256,
  public_origin_contract_version: releaseManifest.public_origin_contract_version,
  public_origin_endpoint_contract_sha256: publicOriginEndpointContractSha256,
};

writeJson("ravenos_release.json", releaseManifest);
writeJson("ravenos_asset_manifest.json", assetManifest);
writeJson("ravenos_build.json", deployBuild);
writeFileSync(join(deployRoot, "_headers"), [
  "/assets/*",
  "  Cache-Control: public, max-age=31536000, immutable",
  "",
  "/ravenos_release.json",
  "  Cache-Control: no-store",
  "",
  "/ravenos_asset_manifest.json",
  "  Cache-Control: no-store",
  "",
  "/ravenos_build.json",
  "  Cache-Control: no-store",
  "",
  "/ravenos_deploy_manifest.json",
  "  Cache-Control: no-store",
  "",
].join("\n"), "utf8");

const artifactFiles = listFiles(deployRoot).sort();
const artifactFileHashes = Object.fromEntries(artifactFiles.map((file) => [file, shaFile(join(deployRoot, file))]));
const artifactContentSha256 = sha256(stableJson(artifactFileHashes));
const deployManifest = {
  schema_version: releaseConfig.deploy_manifest_version || "ravenos.deploy.v2",
  release_id: releaseId,
  source_commit: sourceCommit,
  public_build_id: build.public_build_id,
  generated_at: new Date().toISOString(),
  asset_directory: ".deploy-public",
  route_manifest_version: routeConfig.route_manifest_version || "1.0",
  public_origin_contract_version: releaseManifest.public_origin_contract_version,
  static_asset_manifest_sha256: staticAssetManifestSha256,
  artifact_content_sha256: artifactContentSha256,
  file_hashes: artifactFileHashes,
  files: [...artifactFiles, "ravenos_deploy_manifest.json"].sort(),
};
writeJson("ravenos_deploy_manifest.json", deployManifest);

console.log(`Prepared ${deployManifest.files.length} immutable release assets for ${releaseId}`);
