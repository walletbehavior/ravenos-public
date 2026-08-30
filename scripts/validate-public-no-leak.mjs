import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const deployRoot = join(repoRoot, ".deploy-public");
const textExtensions = new Set([".html", ".js", ".mjs", ".css", ".json", ".map", ".svg", ".webmanifest", ".txt"]);

const internalTerms = [
  "Raven internals",
  "Atlas internals",
  "mirror",
  "mirrors",
  "candidate",
  "candidates",
  "precursor",
  "precursors",
  "wallet promotion",
  "shadow engine",
  "treasury",
  "permission contract",
  "private rail",
  "paper engine",
  "whale routing",
  "cold wallet",
  "promotion engine",
];

const highRiskTextPatterns = [
  ["private_benchmark_provider", /\bgmgn\b/i],
  ["private_filesystem_path", /(?:\/srv\/raven\/app|\/root\/|\/home\/[A-Za-z0-9_.-]+\/|\/etc\/(?:systemd|cloudflared|raven))/i],
  ["private_runtime_route", /\/(?:data\/runtime|services|logs)\/[A-Za-z0-9_./-]+/i],
  ["protected_origin_host", /https?:\/\/ravenos-public-origin\.ravenos\.xyz/i],
  ["private_key_material", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
  ["live_secret_value", /\b(?:sk_live|rk_live|whsec|AKIA)[A-Za-z0-9_/-]{8,}\b/],
  ["model_identifier", /\b(?:gpt-[45]|o[134]-|claude-[0-9]|gemini-[0-9])[A-Za-z0-9_.:-]*\b/i],
  ["synthetic_terminal_payload", /\b(?:samplePrices|perpsInputVector|replayMatches|pressureComposition|smart-wallet-distribution|Raven Paper Candidates)\b|(?:May 2026 compression|March 2026 pressure|January 2026 crowded)/i],
  ["legacy_solana_live_copy", /\bSolana Live Activity\b/i],
];

const forbiddenKeyPatterns = [
  /(^|_)(wallet_address|wallet_id|raw_wallet|relationship_graph)($|_)/i,
  /(^|_)(provider_payload|private_path|source_path|system_prompt|model_id)($|_)/i,
  /(^|_)(execution_intent|execution_reservation|transaction_payload|signed_transaction)($|_)/i,
  /(^|_)(private_key|secret_value|signer_config|safety_controls)($|_)/i,
  /(^|_)(confidence_score|raw_confidence|mirror_activation_bias_score|copyability)($|_)/i,
  /(^|_)(raw_pnl|net_pnl_usd|realized_pnl|unrealized_pnl|pnl_direction)($|_)/i,
];

function listFiles(root, prefix = "") {
  const current = prefix ? join(root, prefix) : root;
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(root, name));
    else if (entry.isFile() && textExtensions.has(extname(entry.name).toLowerCase())) files.push(name);
  }
  return files;
}

function wordPattern(term) {
  return new RegExp(`(^|[^A-Za-z0-9_])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_]|$)`, "i");
}

function isPublicTicker(path, value) {
  return /(?:^|\.)(?:symbol|instrument|top_public_symbols\.\d+)$/.test(path)
    && /^[A-Z0-9._-]{1,20}(?:-PERP)?$/.test(value);
}

export function scanHighRiskText(text, file = "") {
  const findings = [];
  for (const [term, pattern] of highRiskTextPatterns) {
    if (pattern.test(text)) findings.push({ file, path: "", term });
  }
  return findings;
}

function scanVisibleHtml(text, file) {
  const withoutExecutableContent = text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  const visible = withoutExecutableContent
    .replace(/<[^>]+>/g, " ")
    .replace(/&[A-Za-z0-9#]+;/g, " ")
    .replace(/\s+/g, " ");
  const findings = [];
  for (const term of internalTerms) {
    if (wordPattern(term).test(visible)) findings.push({ file, path: "visible_html", term });
  }
  return findings;
}

export function scanJsonValue(value, file = "", path = "") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => findings.push(...scanJsonValue(item, file, path ? `${path}.${index}` : String(index))));
    return findings;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (forbiddenKeyPatterns.some((pattern) => pattern.test(key))) findings.push({ file, path: childPath, term: "private_field" });
      findings.push(...scanJsonValue(child, file, childPath));
    }
    return findings;
  }
  if (typeof value !== "string" || isPublicTicker(path, value)) return findings;
  findings.push(...scanHighRiskText(value, file).map((finding) => ({ ...finding, path })));
  for (const term of internalTerms) {
    if (wordPattern(term).test(value)) findings.push({ file, path, term });
  }
  return findings;
}

export function scanPublicTextFile(text, file) {
  const ext = extname(file).toLowerCase();
  const findings = [...scanHighRiskText(text, file)];
  if (ext === ".json" || ext === ".webmanifest" || ext === ".map") {
    try {
      findings.push(...scanJsonValue(JSON.parse(text), file));
    } catch {
      findings.push({ file, path: "", term: "invalid_json" });
    }
  } else if (ext === ".html") {
    findings.push(...scanVisibleHtml(text, file));
  }
  return findings;
}

export function validateDeployDirectory(root = deployRoot) {
  const findings = [];
  for (const file of listFiles(root)) {
    const text = readFileSync(join(root, file), "utf8");
    findings.push(...scanPublicTextFile(text, file));
  }
  return findings;
}

function main() {
  const findings = validateDeployDirectory();
  if (findings.length) {
    for (const finding of findings) {
      console.error(`file=${finding.file} path=${finding.path || ""} term=${finding.term}`);
    }
    console.error(`RavenOS public no-leak validation failed: ${findings.length} finding(s).`);
    process.exit(1);
  }
  console.log("Validated deploy assets: public_no_leak=true");
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) main();
