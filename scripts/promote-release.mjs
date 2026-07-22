import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cloudflareReleaseEnv } from "./lib/cloudflare-release-env.mjs";

const repoRoot = process.cwd();
const bundleRoot = resolve(process.argv[2] || "");
const receipt = JSON.parse(readFileSync(join(bundleRoot, "stage-receipt.json"), "utf8"));
const packageManifest = JSON.parse(readFileSync(join(bundleRoot, "release-package.json"), "utf8"));
if (!receipt.verified) throw new Error("Refusing to promote an unverified staged release");
if (receipt.release_id !== packageManifest.release_id) throw new Error("Stage receipt and package release identities differ");
if (packageManifest.onchain_chart_provider?.production_promotion_eligible !== true) {
  const blockers = packageManifest.onchain_chart_provider?.production_blockers || ["onchain_chart_provider_not_qualified"];
  throw new Error(`Production promotion blocked by on-chain chart-provider gate: ${blockers.join(", ")}`);
}
const requiredChartIntervals = packageManifest.onchain_chart_provider?.required_intervals || [];
if (!requiredChartIntervals.includes("1m") || Number(packageManifest.onchain_chart_provider?.one_minute_minimum_useful_bars) < 120) {
  throw new Error("Production promotion requires a qualified one-minute chart contract with at least 120 useful bars per advertised chart-ready anchor");
}
if (packageManifest.onchain_chart_provider?.subminute_candles_required !== false) {
  throw new Error("Production promotion chart policy must explicitly keep sub-minute candles out of the required matrix");
}
if (process.env.RAVENOS_PRODUCTION_PROMOTION_AUTHORIZATION !== receipt.release_id) {
  throw new Error("Explicit production authorization is absent or does not name this exact release ID");
}
const cloudflareEnv = cloudflareReleaseEnv(repoRoot);

const result = spawnSync(process.execPath, [
  join(repoRoot, "scripts/run-local-wrangler.mjs"),
  "versions", "deploy",
  `${receipt.worker_version_id}@100%`,
  "--name", receipt.worker_name,
  "--message", `Promote verified RavenOS release ${receipt.release_id}`,
  "--yes",
], {
  cwd: repoRoot,
  env: cloudflareEnv,
  stdio: "inherit",
});
if (result.status !== 0) throw new Error(`Production promotion failed with status ${result.status}`);
