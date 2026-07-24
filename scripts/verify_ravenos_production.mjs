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
  "/api/health",
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

function hasBuildMarker(text) {
  return text.includes("Public artifact verified")
    || text.includes("UI build")
    || text.includes("data-ravenos-build-id")
    || text.includes("data-ravenos-release-id")
    || text.includes('name="ravenos-release-id"');
}

for (const route of pageRoutes) {
  const { res, text } = await fetchText(route);
  if (!res.ok) throw new Error(`${route} returned ${res.status}`);
  if (!hasBuildMarker(text)) throw new Error(`${route} missing build marker`);
  if (/Developer Mode|Loading Structure Lab|WalletMemory|ShadowMirror|Turnkey|treasury/.test(text)) {
    throw new Error(`${route} contains stale developer or private strings`);
  }
}

for (const route of apiRoutes) {
  const { res, json } = await fetchJson(route);
  if (!res.ok || !json || typeof json !== "object") throw new Error(`${route} returned invalid JSON`);
}

const { json: statusJson } = await fetchJson("/api/status");
if (statusJson?.schema_version !== "customer_trade_terminal_health_snapshot.v1") {
  throw new Error("/api/status missing current Terminal health contract");
}

const { json: healthJson } = await fetchJson("/api/health");
if (
  healthJson?.status !== "ok"
  || healthJson?.market_data_health?.state !== "fresh"
  || healthJson?.intelligence_freshness?.state !== "fresh"
  || !["fresh", "delayed"].includes(healthJson?.atlas_health?.state)
  || healthJson?.atlas_health?.operational !== true
  || healthJson?.raven_read_health?.state !== "fresh"
  || healthJson?.narrator_freshness?.state !== "not_required"
  || healthJson?.projection_health?.state !== "operational"
  || healthJson?.publisher_health?.state !== "operational"
  || healthJson?.execution_health?.state !== "disabled"
  || healthJson?.execution_health?.signing_available !== false
  || healthJson?.execution_health?.submission_available !== false
) throw new Error("/api/health does not report a complete fresh read-only production product");

const { json: claimsJson } = await fetchJson("/api/claims");
if (claimsJson?.schema_version !== "ravenos_claim_lineage_public_origin_v2" || claimsJson?.data?.lineage_version !== "2.0") {
  throw new Error("/api/claims missing claim lineage v2");
}
const claimId = claimsJson?.data?.current_claims?.[0]?.claim_id || claimsJson?.data?.claim_history?.[0]?.claim_id;
if (!claimId) throw new Error("/api/claims did not return a public claim");

const { res: claimRes, json: claimJson } = await fetchJson(`/api/claims/${encodeURIComponent(claimId)}`);
if (!claimRes.ok || !claimJson?.claim?.claim_id) throw new Error("Claim detail endpoint did not resolve");

const { res: claimPageRes, text: claimPageText } = await fetchText(`/claims/?id=${encodeURIComponent(claimId)}`);
if (!claimPageRes.ok || !hasBuildMarker(claimPageText)) throw new Error("Claim detail route did not resolve");

const { text: outcomesHtml } = await fetchText("/outcomes/");
if (!/Followthrough check|Outcomes tracks whether earlier Raven reads followed through/i.test(outcomesHtml)) {
  throw new Error("/outcomes/ missing followthrough UI");
}

const { text: researchHtml } = await fetchText("/research/");
if (/0 findings|0 forward observations/.test(researchHtml) && !/No zero should be interpreted as measured evidence/.test(researchHtml)) {
  throw new Error("/research/ is serving false zero fallback text");
}

console.log(`RavenOS production verification passed for ${baseUrl}`);
