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
const previewAlias = "ravenos-stage";

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

async function cloudflare(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${cloudflareEnv.CLOUDFLARE_API_TOKEN}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    throw new Error(`Cloudflare API ${init.method || "GET"} ${path} failed (${response.status})`);
  }
  return payload.result;
}

function wrangler(args, { echo = true } = {}) {
  const result = spawnSync(process.execPath, [join(repoRoot, "scripts/run-local-wrangler.mjs"), ...args], {
    cwd: repoRoot,
    env: cloudflareEnv,
    encoding: "utf8",
  });
  if (echo && result.stdout) process.stdout.write(result.stdout);
  if (echo && result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`Wrangler command failed with status ${result.status}`);
  return result.stdout || "";
}

const secretList = JSON.parse(wrangler([
  "secret", "list",
  "--name", packageManifest.worker_name,
  "--format", "json",
], { echo: false }));
const configuredSecrets = new Set((Array.isArray(secretList) ? secretList : []).map((entry) => entry?.name).filter(Boolean));
const missingSecrets = (packageManifest.required_server_secret_bindings || []).filter((name) => !configuredSecrets.has(name));
if (missingSecrets.length) {
  throw new Error(`Required server-only bindings are absent: ${missingSecrets.join(", ")}`);
}

const configPath = join(bundleRoot, "wrangler.release.jsonc");
function versionList() {
  const parsed = JSON.parse(wrangler(["versions", "list", "--name", packageManifest.worker_name, "--json"], { echo: false }));
  return Array.isArray(parsed) ? parsed : (parsed.items || parsed.versions || []);
}

function taggedVersion(versions) {
  return versions.find((entry) =>
  entry.tag === packageManifest.release_id
  || entry.annotations?.["workers/tag"] === packageManifest.release_id
  || entry.metadata?.tag === packageManifest.release_id
  );
}

let version = taggedVersion(versionList());
let versionReused = Boolean(version?.id && version.annotations?.["workers/alias"] === previewAlias);
if (!versionReused) {
  wrangler([
    "versions", "upload",
    "--config", configPath,
    "--tag", packageManifest.release_id,
    "--message", `RavenOS immutable staged release ${packageManifest.release_id}`,
    "--preview-alias", previewAlias,
    "--keep-vars",
  ]);
  version = taggedVersion(versionList());
}
if (!version?.id) throw new Error("Uploaded Worker version could not be reconciled by release tag");

const accountId = encodeURIComponent(cloudflareEnv.CLOUDFLARE_ACCOUNT_ID);
const scriptName = encodeURIComponent(packageManifest.worker_name);
const accountSubdomain = await cloudflare(`/accounts/${accountId}/workers/subdomain`);
if (!accountSubdomain?.subdomain) throw new Error("Cloudflare Workers account subdomain is unavailable");
const previousSubdomainState = await cloudflare(`/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`);
let currentSubdomainState = previousSubdomainState;
if (previousSubdomainState?.previews_enabled !== true) {
  currentSubdomainState = await cloudflare(`/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`, {
    method: "POST",
    body: JSON.stringify({
      enabled: Boolean(previousSubdomainState?.enabled),
      previews_enabled: true,
    }),
  });
}
if (Boolean(currentSubdomainState?.enabled) !== Boolean(previousSubdomainState?.enabled)) {
  throw new Error("Staging changed the main workers.dev route state");
}
if (currentSubdomainState?.previews_enabled !== true) throw new Error("Cloudflare version previews remain disabled");
const versionDetail = await cloudflare(`/accounts/${accountId}/workers/workers/${scriptName}/versions/${encodeURIComponent(version.id)}`);
const previewUrl = (Array.isArray(versionDetail?.urls) ? versionDetail.urls : [])
  .find((value) => String(value).startsWith("https://"));
if (!previewUrl) throw new Error("Cloudflare did not return the exact version preview URL");
const previewAliasUrl = `https://${previewAlias}-${packageManifest.worker_name}.${accountSubdomain.subdomain}.workers.dev`;

const receipt = {
  schema_version: "ravenos.release_stage_receipt.v1",
  release_id: packageManifest.release_id,
  source_commit: packageManifest.source_commit,
  worker_name: packageManifest.worker_name,
  worker_version_id: version.id,
  worker_version_tag: packageManifest.release_id,
  preview_url: previewUrl,
  preview_alias_url: previewAliasUrl,
  package_content_sha256: packageManifest.package_content_sha256,
  deployment_class: packageManifest.deployment_class,
  required_server_secret_bindings_verified: packageManifest.required_server_secret_bindings || [],
  worker_version_reused: versionReused,
  preview_configuration: {
    main_workers_dev_enabled: Boolean(currentSubdomainState.enabled),
    version_previews_enabled: Boolean(currentSubdomainState.previews_enabled),
    version_previews_changed: previousSubdomainState?.previews_enabled !== currentSubdomainState?.previews_enabled,
  },
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
