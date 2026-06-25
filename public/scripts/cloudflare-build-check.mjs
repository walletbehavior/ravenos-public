import { existsSync, readFileSync } from "node:fs";

const required = [
  "index.html",
  "pricing/index.html",
  "upgrade/index.html",
  "account/index.html",
  "terminal/index.html",
  "research/index.html",
  "ravenos-access.js",
  "ravenos_build.json",
  "ravenos-evidence.css",
  "ravenos-funnel.css",
  "functions/api/access.js",
  "public/index.html",
  "public/research/index.html",
  "public/ravenos_build.json",
  "public/ravenos-evidence.css",
  "public/ravenos-funnel.css",
  "public/ravenos_research_snapshot.json",
];

const missing = required.filter((path) => !existsSync(path));

if (missing.length) {
  console.error(`Missing Cloudflare Pages artifacts: ${missing.join(", ")}`);
  process.exit(1);
}

const rootResearch = readFileSync("research/index.html", "utf8");
const publicResearch = readFileSync("public/research/index.html", "utf8");
const rootBuild = readFileSync("ravenos_build.json", "utf8");
const publicBuild = readFileSync("public/ravenos_build.json", "utf8");

if (rootResearch !== publicResearch) {
  console.error("Research route mismatch: research/index.html does not match public/research/index.html");
  process.exit(1);
}

if (rootBuild !== publicBuild) {
  console.error("Build metadata mismatch: ravenos_build.json does not match public/ravenos_build.json");
  process.exit(1);
}

const forbiddenPublicTerms = ["Developer Mode", "Loading Structure Lab"];
const leaked = forbiddenPublicTerms.filter((term) => publicResearch.includes(term) || rootResearch.includes(term));
if (leaked.length) {
  console.error(`Public Research shell contains development terms: ${leaked.join(", ")}`);
  process.exit(1);
}

const requiredResearchText = [
  "Research Details",
  "Current public research snapshot unavailable",
  "No zero should be interpreted as measured evidence",
  "Evidence Role",
];
const absentResearchText = requiredResearchText.filter((term) => !publicResearch.includes(term));
if (absentResearchText.length) {
  console.error(`Public Research shell missing expected product-state text: ${absentResearchText.join(", ")}`);
  process.exit(1);
}

const build = JSON.parse(publicBuild);
if (!build.ui_build || !build.built_at || !build.public_build_id) {
  console.error("Build metadata must include ui_build, public_build_id, and built_at");
  process.exit(1);
}

if (!build.api_schema_versions?.evidence_contract || !build.api_schema_versions?.claim_lineage) {
  console.error("Build metadata must include api schema versions");
  process.exit(1);
}

console.log("RavenOS Cloudflare Pages artifacts verified.");
