import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

import worker from "../worker.mjs";
import { scanJsonValue, scanPublicTextFile } from "./validate-public-no-leak.mjs";

const repoRoot = process.cwd();
const deployRoot = join(repoRoot, ".deploy-public");

const assets = {
  async fetch(request) {
    const pathname = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
    const normalized = normalize(pathname || "index.html");
    if (normalized.startsWith("..")) return new Response("not found", { status: 404 });
    try {
      const body = await readFile(join(deployRoot, normalized));
      const type = extname(normalized) === ".json" ? "application/json" : "application/octet-stream";
      return new Response(body, { headers: { "content-type": type } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  },
};

const env = { ASSETS: assets };
const checks = [
  ["GET", "/api/health"],
  ["GET", "/api/status"],
  ["GET", "/api/brief"],
  ["GET", "/api/replay"],
  ["GET", "/api/outcomes"],
  ["GET", "/api/memory"],
  ["GET", "/api/behavior"],
  ["GET", "/api/perps"],
  ["GET", "/api/perps/instrument?symbol=SOL"],
  ["GET", "/api/hyperliquid/instrument?symbol=SOL"],
  ["GET", "/api/research"],
  ["GET", "/api/claims/not-a-real-claim"],
  ["GET", "/api/opportunity"],
  ["GET", "/api/terminal"],
  ["GET", "/api/chains/solana"],
  ["GET", "/api/chains/base"],
  ["GET", "/api/chains/ethereum"],
  ["GET", "/api/trade/flags"],
  ["GET", "/api/access"],
  ["GET", "/api/not-a-route"],
  ["POST", "/api/trade/quote", {}],
  ["POST", "/api/trade/inspect", {}],
  ["POST", "/api/stripe/checkout", {}],
];

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ ok: false }), {
  status: 503,
  headers: { "content-type": "application/json" },
});

const findings = [];
try {
  for (const [method, path, body] of checks) {
    const request = new Request(`https://ravenos.xyz${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = await worker.fetch(request, env);
    const text = await response.text();
    const label = `worker:${method}:${path}:${response.status}`;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        findings.push(...scanJsonValue(JSON.parse(text), label));
      } catch {
        findings.push({ file: label, path: "", term: "invalid_json_response" });
      }
    } else {
      findings.push(...scanPublicTextFile(text, `${label}.txt`));
    }
  }
} finally {
  globalThis.fetch = originalFetch;
}

if (findings.length) {
  for (const finding of findings) console.error(`file=${finding.file} path=${finding.path || ""} term=${finding.term}`);
  console.error(`RavenOS Worker response no-leak validation failed: ${findings.length} finding(s).`);
  process.exit(1);
}

console.log(`Validated Worker responses: routes=${checks.length} public_no_leak=true`);
