import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cloudflareReleaseEnv } from "./lib/cloudflare-release-env.mjs";

const repoRoot = process.cwd();
const bundleRoot = resolve(process.argv[2] || "");
const receipt = JSON.parse(readFileSync(join(bundleRoot, "stage-receipt.json"), "utf8"));
const packageManifest = JSON.parse(readFileSync(join(bundleRoot, "release-package.json"), "utf8"));
if (!receipt.verified) throw new Error("Refusing to roll back to an unverified release");
if (receipt.release_id !== packageManifest.release_id) throw new Error("Stage receipt and package release identities differ");
if (process.env.RAVENOS_PRODUCTION_ROLLBACK_AUTHORIZATION !== receipt.release_id) {
  throw new Error("Explicit rollback authorization is absent or does not name this exact release ID");
}
const cloudflareEnv = cloudflareReleaseEnv(repoRoot);

const result = spawnSync(process.execPath, [
  join(repoRoot, "scripts/run-local-wrangler.mjs"),
  "versions", "deploy",
  `${receipt.worker_version_id}@100%`,
  "--name", receipt.worker_name,
  "--message", `Roll back RavenOS to verified release ${receipt.release_id}`,
  "--yes",
], {
  cwd: repoRoot,
  env: cloudflareEnv,
  stdio: "inherit",
});
if (result.status !== 0) throw new Error(`Production rollback failed with status ${result.status}`);
