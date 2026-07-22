import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { evaluateReleasePromotion } from "../lib/release_promotion_policy.mjs";
import { cloudflareReleaseEnv } from "./lib/cloudflare-release-env.mjs";

const repoRoot = process.cwd();
const bundleRoot = resolve(process.argv[2] || "");
const receipt = JSON.parse(readFileSync(join(bundleRoot, "stage-receipt.json"), "utf8"));
const packageManifest = JSON.parse(readFileSync(join(bundleRoot, "release-package.json"), "utf8"));
const previewVerification = JSON.parse(readFileSync(join(bundleRoot, "preview-verification.json"), "utf8"));
if (!receipt.verified) throw new Error("Refusing to promote an unverified staged release");
if (receipt.release_id !== packageManifest.release_id) throw new Error("Stage receipt and package release identities differ");
if (previewVerification.ok !== true || previewVerification.release_id !== receipt.release_id) {
  throw new Error("Preview verification and staged release identities differ");
}
const chartProvider = packageManifest.onchain_chart_provider || {};
const deploymentClass = packageManifest.deployment_class || "commercial_production";
const publicEvaluation = deploymentClass === "public_evaluation";
const policy = evaluateReleasePromotion({ deploymentClass, chartProvider, previewVerification });
if (!policy.eligible) throw new Error(`Release promotion blocked: ${policy.reasons.join(", ")}`);
const providerSecretBinding = chartProvider.provider_secret_binding || "ONCHAIN_CHART_PROVIDER_SECRET";
if (!(receipt.required_server_secret_bindings_verified || []).includes(providerSecretBinding)) {
  throw new Error("Production promotion requires the selected chart provider's generic server-only secret binding");
}
const authorizationVariable = publicEvaluation
  ? "RAVENOS_PUBLIC_EVALUATION_PROMOTION_AUTHORIZATION"
  : "RAVENOS_PRODUCTION_PROMOTION_AUTHORIZATION";
if (process.env[authorizationVariable] !== receipt.release_id) {
  throw new Error(`Explicit ${deploymentClass} authorization is absent or does not name this exact release ID`);
}
const cloudflareEnv = cloudflareReleaseEnv(repoRoot);

const result = spawnSync(process.execPath, [
  join(repoRoot, "scripts/run-local-wrangler.mjs"),
  "versions", "deploy",
  `${receipt.worker_version_id}@100%`,
  "--name", receipt.worker_name,
  "--message", `Promote verified RavenOS ${deploymentClass} release ${receipt.release_id}`,
  "--yes",
], {
  cwd: repoRoot,
  env: cloudflareEnv,
  stdio: "inherit",
});
if (result.status !== 0) throw new Error(`Production promotion failed with status ${result.status}`);
