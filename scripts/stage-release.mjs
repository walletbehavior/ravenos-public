import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cloudflareReleaseEnv } from "./lib/cloudflare-release-env.mjs";

const repoRoot = process.cwd();
const bundleRoot = resolve(process.argv[2] || "");
if (!bundleRoot || !existsSync(join(bundleRoot, "release-package.json"))) {
  throw new Error("Usage: node scripts/stage-release.mjs <release-bundle-dir>");
}
const packageManifest = JSON.parse(readFileSync(join(bundleRoot, "release-package.json"), "utf8"));
if (packageManifest.source_tree_state !== "clean") throw new Error("Only a clean release package may be uploaded to staging");

const checksumLines = readFileSync(join(bundleRoot, "SHA256SUMS"), "utf8").trim().split(/\r?\n/);
const crypto = await import("node:crypto");
for (const line of checksumLines) {
  const match = line.match(/^([0-9a-f]{64})  (.+)$/);
  if (!match) throw new Error(`Malformed release checksum line: ${line}`);
  const target = join(bundleRoot, match[2]);
  const actual = crypto.createHash("sha256").update(readFileSync(target)).digest("hex");
  if (actual !== match[1]) throw new Error(`Release checksum mismatch: ${match[2]}`);
}

const cloudflareEnv = cloudflareReleaseEnv(repoRoot);

function wrangler(args) {
  const result = spawnSync(process.execPath, [join(repoRoot, "scripts/run-local-wrangler.mjs"), ...args], {
    cwd: repoRoot,
    env: cloudflareEnv,
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`Wrangler command failed with status ${result.status}`);
  return result.stdout || "";
}

const secretList = JSON.parse(wrangler([
  "secret", "list",
  "--name", packageManifest.worker_name,
  "--format", "json",
]));
const configuredSecrets = new Set((Array.isArray(secretList) ? secretList : []).map((entry) => entry?.name).filter(Boolean));
const missingSecrets = (packageManifest.required_server_secret_bindings || []).filter((name) => !configuredSecrets.has(name));
if (missingSecrets.length) {
  throw new Error(`Required server-only bindings are absent: ${missingSecrets.join(", ")}`);
}

const configPath = join(bundleRoot, "wrangler.release.jsonc");
const uploadOutput = wrangler([
  "versions", "upload",
  "--config", configPath,
  "--tag", packageManifest.release_id,
  "--message", `RavenOS immutable staged release ${packageManifest.release_id}`,
  "--preview-alias", "ravenos-stage",
  "--keep-vars",
]);
const versionsText = wrangler(["versions", "list", "--name", packageManifest.worker_name, "--json"]);
const parsedVersions = JSON.parse(versionsText);
const versions = Array.isArray(parsedVersions) ? parsedVersions : (parsedVersions.items || parsedVersions.versions || []);
const version = versions.find((entry) =>
  entry.tag === packageManifest.release_id
  || entry.annotations?.["workers/tag"] === packageManifest.release_id
  || entry.metadata?.tag === packageManifest.release_id
);
if (!version?.id) throw new Error("Uploaded Worker version could not be reconciled by release tag");
const previewUrl = (uploadOutput.match(/https:\/\/[^\s]+\.workers\.dev\/?/g) || []).at(-1);
if (!previewUrl) throw new Error("Wrangler did not return a version preview URL");

const receipt = {
  schema_version: "ravenos.release_stage_receipt.v1",
  release_id: packageManifest.release_id,
  source_commit: packageManifest.source_commit,
  worker_name: packageManifest.worker_name,
  worker_version_id: version.id,
  worker_version_tag: packageManifest.release_id,
  preview_url: previewUrl.replace(/\/$/, ""),
  package_content_sha256: packageManifest.package_content_sha256,
  required_server_secret_bindings_verified: packageManifest.required_server_secret_bindings || [],
  staged_at: new Date().toISOString(),
  production_traffic_changed: false,
  verified: false,
};
writeFileSync(join(bundleRoot, "stage-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

const verify = spawnSync(process.execPath, [join(repoRoot, "scripts/verify-release-preview.mjs"), receipt.preview_url, bundleRoot], {
  cwd: repoRoot,
  env: cloudflareEnv,
  encoding: "utf8",
});
if (verify.stdout) process.stdout.write(verify.stdout);
if (verify.stderr) process.stderr.write(verify.stderr);
if (verify.status !== 0) throw new Error(`Release preview verification failed with status ${verify.status}`);
receipt.verified = true;
receipt.verified_at = new Date().toISOString();
writeFileSync(join(bundleRoot, "stage-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify(receipt, null, 2));
