import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

if (!process.version.startsWith("v22.")) {
  console.error(`Wrangler deploy tooling must run on Node 22. Current runtime: ${process.version}`);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const wranglerRoot = dirname(require.resolve("wrangler/package.json"));
const wranglerBin = join(wranglerRoot, "bin", "wrangler.js");
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [wranglerBin, ...args], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
