import { scanJsonValue } from "./validate-public-no-leak.mjs";

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
  "/api/onchain/trending?chains=base,ethereum&duration=5m",
  "/api/chains/solana",
  "/api/chains/base",
  "/api/chains/ethereum",
];

async function fetchText(path) {
  const res = await fetch(new URL(path, baseUrl), { headers: { "cache-control": "no-cache" } });
  const text = await res.text();
  return { res, text };
}

async function fetchJson(path, { method = "GET", body = undefined } = {}) {
  const res = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      "cache-control": "no-cache",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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

const { res: flagsRes, json: flagsJson } = await fetchJson("/api/trade/flags");
if (
  !flagsRes.ok
  || flagsJson?.market_preview_available !== true
  || !flagsJson?.market_preview_markets?.includes("hyperliquid_perpetual")
  || flagsJson?.order_plan_available !== true
  || !flagsJson?.order_plan_markets?.includes("hyperliquid_perpetual")
  || !["market", "limit", "trigger"].every((orderType) => flagsJson?.order_plan_types?.includes(orderType))
  || flagsJson?.signing_available !== false
  || flagsJson?.submission_available !== false
) throw new Error("/api/trade/flags does not advertise the non-executable Hyperliquid planning boundary");

const { res: onchainPulseRes, json: onchainPulseJson } = await fetchJson(
  "/api/onchain/trending?chains=base,ethereum&duration=5m",
);
const pulseRows = onchainPulseJson?.rows;
if (
  !onchainPulseRes.ok
  || onchainPulseJson?.schema_version !== "ravenos.onchain_market_pulse.v1"
  || onchainPulseJson?.safe_public !== true
  || onchainPulseJson?.freshness?.state !== "current"
  || onchainPulseJson?.provenance?.raven_signal !== false
  || !Array.isArray(pulseRows)
  || !["base", "ethereum"].every((chain) => pulseRows.some((row) => (
    row?.chain_id === chain
    && row?.identity_scope === "exact_pool"
    && row?.source_type === "market_activity"
    && row?.instrument_id === `${chain}:pool:${row?.pool_address}`
    && row?.execution_available === false
  )))
  || onchainPulseJson?.execution_boundary?.signing_available !== false
  || onchainPulseJson?.execution_boundary?.submission_available !== false
) throw new Error("/api/onchain/trending did not return current exact-pool Base and Ethereum activity");

const { res: marketPreviewRes, json: marketPreviewJson } = await fetchJson("/api/trade/market-preview", {
  method: "POST",
  body: {
    instrument_id: "hyperliquid:perp:SOL",
    side: "long",
    notional_usdc: 500,
    leverage: 3,
    max_impact_bps: 100,
  },
});
if (
  !marketPreviewRes.ok
  || marketPreviewJson?.schema_version !== "ravenos.hyperliquid_market_preview.v1"
  || marketPreviewJson?.instrument?.instrument_id !== "hyperliquid:perp:SOL"
  || marketPreviewJson?.provenance?.source !== "live_l2_book"
  || marketPreviewJson?.provenance?.exact_identity !== true
  || marketPreviewJson?.execution_boundary?.prepared_order_available !== false
  || marketPreviewJson?.execution_boundary?.signing_available !== false
  || marketPreviewJson?.execution_boundary?.submission_available !== false
) throw new Error("/api/trade/market-preview is not an exact, live-book, non-executable preview");
const marketPreviewNoLeakFindings = scanJsonValue(marketPreviewJson, "production:/api/trade/market-preview");
if (marketPreviewNoLeakFindings.length) {
  const fields = marketPreviewNoLeakFindings.map((finding) => `${finding.path || "<root>"}:${finding.term}`).join(", ");
  throw new Error(`Production market preview failed the public no-leak gate: ${fields}`);
}

const { res: orderPlanRes, json: orderPlanJson } = await fetchJson("/api/trade/order-plan", {
  method: "POST",
  body: {
    instrument_id: "hyperliquid:perp:SOL",
    side: "long",
    order_type: "market",
    notional_usdc: 500,
    leverage: 3,
    max_impact_bps: 100,
  },
});
if (
  !orderPlanRes.ok
  || orderPlanJson?.ok !== true
  || orderPlanJson?.schema_version !== "ravenos.hyperliquid_order_plan.v1"
  || orderPlanJson?.instrument?.instrument_id !== "hyperliquid:perp:SOL"
  || orderPlanJson?.intent?.order_type !== "market"
  || orderPlanJson?.entry_model?.state !== "current_book_fill_estimate"
  || orderPlanJson?.provenance?.source !== "live_l2_book"
  || orderPlanJson?.provenance?.exact_identity !== true
  || orderPlanJson?.review?.prepared_payload_included !== false
  || orderPlanJson?.execution_boundary?.prepared_order_available !== false
  || orderPlanJson?.execution_boundary?.signing_available !== false
  || orderPlanJson?.execution_boundary?.submission_available !== false
) throw new Error("/api/trade/order-plan is not an exact, live-book, non-executable plan");
const orderPlanNoLeakFindings = scanJsonValue(orderPlanJson, "production:/api/trade/order-plan");
if (orderPlanNoLeakFindings.length) {
  const fields = orderPlanNoLeakFindings.map((finding) => `${finding.path || "<root>"}:${finding.term}`).join(", ");
  throw new Error(`Production order plan failed the public no-leak gate: ${fields}`);
}

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

const chartAnchor = {
  chain: "solana",
  pair: "6HfaJiUuTXFZEfmdkQSNbvfe6i95Nh2wUVJ5dWMf7gtw",
  token: "zGh48JtNHVBb5evgoZLXwgPD2Qu4MhkWdJLGDAupump",
  quote: "So11111111111111111111111111111111111111112",
};
const chartParams = new URLSearchParams({
  market: "crypto_spot",
  asset: "RETIRE/SOL",
  timeframe: "1m",
  limit: "480",
  chain: chartAnchor.chain,
  pair_address: chartAnchor.pair,
  token_address: chartAnchor.token,
  quote_address: chartAnchor.quote,
});
const { res: chartRes, json: chartEnvelope } = await fetchJson(`/api/terminal/chart?${chartParams.toString()}`);
const chart = chartEnvelope?.data || chartEnvelope;
if (
  !chartRes.ok
  || chart?.ok !== true
  || chart?.market_identity !== `${chartAnchor.chain}:${chartAnchor.pair}`
  || chart?.instrument?.pool_address !== chartAnchor.pair
  || chart?.candle_series?.provider !== "coingecko_onchain"
  || chart?.candle_series?.role !== "base_ohlcv"
  || chart?.candle_series?.raven_observations_are_candles !== false
  || chart?.provider_selection?.fallback !== false
  || !Array.isArray(chart?.candles)
  || chart.candles.length < 120
) {
  throw new Error("/api/terminal/chart did not return the exact current provider-backed production anchor");
}
const chartNoLeakFindings = scanJsonValue(chartEnvelope, "production:/api/terminal/chart");
if (chartNoLeakFindings.length) {
  const fields = chartNoLeakFindings.map((finding) => `${finding.path || "<root>"}:${finding.term}`).join(", ");
  throw new Error(`Production chart response failed the public no-leak gate: ${fields}`);
}

for (const chain of ["base", "ethereum"]) {
  const row = pulseRows.find((candidate) => candidate?.chain_id === chain && candidate?.identity_scope === "exact_pool");
  const params = new URLSearchParams({
    market: "crypto_spot",
    asset: `${row.symbol}/${row.quote_symbol}`,
    timeframe: "1m",
    limit: "240",
    chain,
    pair_address: row.pool_address,
    token_address: row.token_address,
    quote_address: row.quote_token_address,
    instrument_scope: "exact_pool",
  });
  const { res, json: envelope } = await fetchJson(`/api/terminal/chart?${params.toString()}`);
  const payload = envelope?.data || envelope;
  if (
    !res.ok
    || payload?.ok !== true
    || payload?.market_identity !== `${chain}:${row.pool_address}`
    || payload?.instrument?.pool_address !== row.pool_address
    || payload?.instrument?.token_address?.toLowerCase() !== row.token_address.toLowerCase()
    || payload?.candle_series?.provider !== "coingecko_onchain"
    || payload?.candle_series?.raven_observations_are_candles !== false
    || !Array.isArray(payload?.candles)
    || payload.candles.length < 120
  ) throw new Error(`Production ${chain} market pulse row did not open a dense exact-pool one-minute chart`);
  const findings = scanJsonValue(envelope, `production:/api/terminal/chart:${chain}`);
  if (findings.length) {
    const fields = findings.map((finding) => `${finding.path || "<root>"}:${finding.term}`).join(", ");
    throw new Error(`Production ${chain} chart response failed the public no-leak gate: ${fields}`);
  }
}

console.log(`RavenOS production verification passed for ${baseUrl}`);
