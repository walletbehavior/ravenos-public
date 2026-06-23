import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const required = [
  "index.html",
  "pricing/index.html",
  "upgrade/index.html",
  "account/index.html",
  "terminal/index.html",
  "ravenos-access.js",
];

const missing = required.filter((path) => !existsSync(path));

if (missing.length) {
  console.error(`Missing RavenOS static artifacts: ${missing.join(", ")}`);
  process.exit(1);
}

const nestedOutput = "public";
rmSync(nestedOutput, { force: true, recursive: true });
mkdirSync(nestedOutput, { recursive: true });

for (const entry of readdirSync(".")) {
  if (entry === nestedOutput || entry === "node_modules" || entry === "package-lock.json") continue;
  cpSync(entry, join(nestedOutput, entry), { recursive: true });
}

console.log("RavenOS static artifacts verified.");
