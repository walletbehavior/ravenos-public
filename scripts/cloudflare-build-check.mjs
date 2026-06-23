import { existsSync } from "node:fs";

const required = [
  "index.html",
  "pricing/index.html",
  "upgrade/index.html",
  "account/index.html",
  "alerts/index.html",
  "watchlists/index.html",
  "terminal/index.html",
  "ravenos-access.js",
  "ravenos-explanations.js",
  "functions/api/access.js",
];

const missing = required.filter((path) => !existsSync(path));

if (missing.length) {
  console.error(`Missing Cloudflare Pages artifacts: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("RavenOS Cloudflare Pages artifacts verified.");
