import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { cloudflareReleaseEnv } from "./lib/cloudflare-release-env.mjs";

const repoRoot = process.cwd();
const args = process.argv.slice(2);
if (!args.length) throw new Error("Usage: node scripts/run-cloudflare-wrangler.mjs <wrangler arguments>");

const result = spawnSync(process.execPath, [join(repoRoot, "scripts/run-local-wrangler.mjs"), ...args], {
  cwd: repoRoot,
  env: cloudflareReleaseEnv(repoRoot),
  stdio: "inherit",
});

process.exit(result.status ?? 1);
