import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

const repoRoot = process.cwd();
const args = new Set(process.argv.slice(2));
const allowDirty = args.has("--allow-dirty");
const replace = args.has("--replace");
const release = JSON.parse(readFileSync(join(repoRoot, ".deploy-public/ravenos_release.json"), "utf8"));
const deploy = JSON.parse(readFileSync(join(repoRoot, ".deploy-public/ravenos_deploy_manifest.json"), "utf8"));
const baseWrangler = JSON.parse(readFileSync(join(repoRoot, "wrangler.jsonc"), "utf8"));
const releaseConfig = JSON.parse(readFileSync(join(repoRoot, "config/release.json"), "utf8"));
const releasesRoot = join(repoRoot, ".releases");
const bundleRoot = join(releasesRoot, release.release_id);
const archivePath = join(releasesRoot, `${release.release_id}.tar.gz`);

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

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const head = git(["rev-parse", "HEAD"]);
const status = git(["status", "--porcelain=v1", "--untracked-files=normal"]);
if (head !== release.source_commit) {
  throw new Error(`Release source commit ${release.source_commit} does not match HEAD ${head}; regenerate first.`);
}
if (status && !allowDirty) {
  throw new Error("Refusing to package a dirty source tree. Commit the release source, regenerate, and retry.");
}
if (release.source_tree_state !== "clean" && !allowDirty) {
  throw new Error(`Refusing release manifest with source_tree_state=${release.source_tree_state}.`);
}
if (existsSync(bundleRoot) && !replace) {
  throw new Error(`Release bundle already exists: ${bundleRoot}. Pass --replace only for an unpromoted local bundle.`);
}
if (existsSync(bundleRoot)) rmSync(bundleRoot, { recursive: true, force: true });
if (existsSync(archivePath) && replace) rmSync(archivePath, { force: true });
mkdirSync(bundleRoot, { recursive: true });

cpSync(join(repoRoot, ".deploy-public"), join(bundleRoot, "assets"), { recursive: true });
cpSync(join(repoRoot, "worker.mjs"), join(bundleRoot, "worker.mjs"));
cpSync(join(repoRoot, "ravenos-chart-data-plane.js"), join(bundleRoot, "ravenos-chart-data-plane.js"));
cpSync(join(repoRoot, "lib"), join(bundleRoot, "lib"), { recursive: true });

const releaseWrangler = {
  name: baseWrangler.name,
  main: "worker.mjs",
  compatibility_date: baseWrangler.compatibility_date,
  preview_urls: true,
  keep_vars: true,
  observability: baseWrangler.observability,
  assets: {
    binding: "ASSETS",
    directory: "assets",
    run_worker_first: true,
  },
  version_metadata: {
    binding: "CF_VERSION_METADATA",
  },
  routes: baseWrangler.routes,
  compatibility_flags: baseWrangler.compatibility_flags,
  vars: {
    RAVENOS_RELEASE_ENFORCE: "1",
    RAVENOS_RELEASE_ID: release.release_id,
    RAVENOS_SOURCE_COMMIT: release.source_commit,
    RAVENOS_STATIC_ASSET_MANIFEST_SHA256: release.static_asset_manifest_sha256,
    RAVENOS_PUBLIC_ORIGIN_CONTRACT_VERSION: release.public_origin_contract_version,
    RAVENOS_PUBLIC_ORIGIN_URL: releaseConfig.public_origin.base_url,
  },
};
writeFileSync(join(bundleRoot, "wrangler.release.jsonc"), `${JSON.stringify(releaseWrangler, null, 2)}\n`, "utf8");

const packagedFiles = listFiles(bundleRoot).sort();
const fileHashes = Object.fromEntries(packagedFiles.map((file) => [file, shaFile(join(bundleRoot, file))]));
const packageContentSha256 = sha256(JSON.stringify(stableObject(fileHashes)));
const packageManifest = {
  schema_version: "ravenos.release_package.v1",
  release_id: release.release_id,
  source_commit: release.source_commit,
  source_tree_state: status ? "dirty" : "clean",
  packaged_at: new Date().toISOString(),
  package_content_sha256: packageContentSha256,
  static_asset_manifest_sha256: release.static_asset_manifest_sha256,
  artifact_content_sha256: deploy.artifact_content_sha256,
  public_origin_contract_version: release.public_origin_contract_version,
  worker_name: baseWrangler.name,
  required_server_secret_bindings: [
    "RAVENOS_PUBLIC_ORIGIN_TOKEN",
    "RAVENOS_SPOT_CHART_ORIGIN_TOKEN"
  ],
  promotion_requires_explicit_authorization: true,
  rebuild_after_staging_permitted: false,
  files: fileHashes,
};
writeFileSync(join(bundleRoot, "release-package.json"), `${JSON.stringify(packageManifest, null, 2)}\n`, "utf8");

const checksumFiles = [...listFiles(bundleRoot).sort()];
const checksums = checksumFiles.map((file) => `${shaFile(join(bundleRoot, file))}  ${file}`).join("\n") + "\n";
writeFileSync(join(bundleRoot, "SHA256SUMS"), checksums, "utf8");

mkdirSync(dirname(archivePath), { recursive: true });
const archive = spawnSync("tar", ["-czf", archivePath, "-C", releasesRoot, release.release_id], {
  cwd: repoRoot,
  encoding: "utf8",
});
if (archive.status !== 0) throw new Error(`Release archive failed: ${archive.stderr || archive.stdout}`);

console.log(JSON.stringify({
  ok: true,
  release_id: release.release_id,
  source_commit: release.source_commit,
  source_tree_state: packageManifest.source_tree_state,
  bundle: relative(repoRoot, bundleRoot),
  archive: relative(repoRoot, archivePath),
  archive_sha256: shaFile(archivePath),
  package_content_sha256: packageContentSha256,
}, null, 2));
