import { existsSync } from "node:fs";

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

console.log("RavenOS static artifacts verified.");
