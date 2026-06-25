const baseUrl = process.argv[2] || process.env.RAVENOS_VERIFY_BASE_URL || "https://ravenos.xyz";

const pageRoutes = [
  "/",
  "/brief/",
  "/opportunity/",
  "/terminal/",
  "/replay/",
  "/outcomes/",
  "/claims/",
  "/memory/",
  "/behavior/",
  "/research/",
  "/perps/",
  "/chains/solana/",
  "/chains/base/",
  "/chains/ethereum/",
];

const apiRoutes = [
  "/api/status",
  "/api/brief",
  "/api/opportunity",
  "/api/terminal",
  "/api/replay",
  "/api/outcomes",
  "/api/claims",
  "/api/memory",
  "/api/behavior",
  "/api/research",
  "/api/perps",
  "/api/chains/solana",
  "/api/chains/base",
  "/api/chains/ethereum",
];

async function fetchText(path) {
  const res = await fetch(new URL(path, baseUrl), { headers: { "cache-control": "no-cache" } });
  const text = await res.text();
  return { res, text };
}

async function fetchJson(path) {
  const res = await fetch(new URL(path, baseUrl), { headers: { "cache-control": "no-cache" } });
  const json = await res.json().catch(() => null);
  return { res, json };
}

for (const route of pageRoutes) {
  const { res, text } = await fetchText(route);
  if (!res.ok) throw new Error(`${route} returned ${res.status}`);
  if (!text.includes("UI build")) throw new Error(`${route} missing build marker`);
  if (/Developer Mode|Loading Structure Lab|WalletMemory|ShadowMirror|Turnkey|treasury/.test(text)) {
    throw new Error(`${route} contains stale developer or private strings`);
  }
}

for (const route of apiRoutes) {
  const { res, json } = await fetchJson(route);
  if (!res.ok || !json || typeof json !== "object") throw new Error(`${route} returned invalid JSON`);
}

const { json: statusJson } = await fetchJson("/api/status");
if (statusJson?.claim_lineage_version !== "2.0") throw new Error("/api/status missing claim lineage v2");
if (statusJson?.api_schema_versions?.evidence_contract !== "1.0") throw new Error("/api/status missing evidence contract v1");

const { json: claimsJson } = await fetchJson("/api/claims");
const claimId = claimsJson?.data?.current_claims?.[0]?.claim_id || claimsJson?.data?.claim_history?.[0]?.claim_id;
if (!claimId) throw new Error("/api/claims did not return a public claim");

const { res: claimRes, json: claimJson } = await fetchJson(`/api/claims/${encodeURIComponent(claimId)}`);
if (!claimRes.ok || !claimJson?.claim?.claim_id) throw new Error("Claim detail endpoint did not resolve");

const { res: claimPageRes, text: claimPageText } = await fetchText(`/claims/?id=${encodeURIComponent(claimId)}`);
if (!claimPageRes.ok || !claimPageText.includes("UI build")) throw new Error("Claim detail route did not resolve");

const { text: outcomesHtml } = await fetchText("/outcomes/");
if (!/Claim-To-Outcome Loop|What happened after Raven's earlier reads\?/.test(outcomesHtml)) {
  throw new Error("/outcomes/ missing proof-rail UI");
}

const { text: researchHtml } = await fetchText("/research/");
if (/0 findings|0 forward observations/.test(researchHtml) && !/No zero should be interpreted as measured evidence/.test(researchHtml)) {
  throw new Error("/research/ is serving false zero fallback text");
}

console.log(`RavenOS production verification passed for ${baseUrl}`);
