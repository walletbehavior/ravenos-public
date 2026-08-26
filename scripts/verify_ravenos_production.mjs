import { scanJsonValue } from "./validate-public-no-leak.mjs";

const baseUrl = process.argv[2] || process.env.RAVENOS_VERIFY_BASE_URL || "https://ravenos.xyz";
const requireJupiterVelocity = ["1", "true", "yes"].includes(String(process.env.RAVENOS_VERIFY_JUPITER_VELOCITY || "").trim().toLowerCase());

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
  "/api/onchain/trending?chains=base,ethereum,robinhood&duration=5m",
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
  || flagsJson?.public_account_view_available !== true
  || !flagsJson?.public_account_view_venues?.includes("hyperliquid")
  || flagsJson?.browser_wallet_connection_available !== true
  || flagsJson?.wallet_connection_scope !== "public_address_observation_only"
  || flagsJson?.wallet_signature_requested !== false
  || flagsJson?.wallet_connection_persisted !== false
  || flagsJson?.account_scenario_available !== true
  || !flagsJson?.account_scenario_venues?.includes("hyperliquid")
  || flagsJson?.account_history_available !== true
  || !flagsJson?.account_history_types?.includes("orders")
  || flagsJson?.signing_available !== false
  || flagsJson?.submission_available !== false
) throw new Error("/api/trade/flags does not advertise the non-executable Hyperliquid planning boundary");

const { res: perpsUniverseRes, json: perpsUniverseJson } = await fetchJson("/api/hyperliquid/perps");
const { res: perpsProjectionRes, json: perpsProjectionJson } = await fetchJson("/api/perps");
const retainedPerpInstruments = new Set(
  (perpsProjectionJson?.data?.instrument_context?.rows || [])
    .map((row) => String(row?.instrument || "").trim().toUpperCase())
    .filter(Boolean),
);
const liveReadCandidate = (perpsUniverseJson?.results || []).find((row) => (
  row?.symbol
  && !retainedPerpInstruments.has(String(row.asset || `${row.symbol}-PERP`).toUpperCase())
  && Number(row.mark_price) > 0
  && row.funding_rate !== null
  && Number(row.open_interest_usd) > 0
  && Number(row.day_notional_volume_usd) > 0
)) || null;
if (!perpsUniverseRes.ok || !perpsProjectionRes.ok || !liveReadCandidate) {
  throw new Error("Hyperliquid universe has no exact market outside retained Raven decision history");
}
const { res: livePerpRes, json: livePerpJson } = await fetchJson(
  `/api/perps/instrument?symbol=${encodeURIComponent(liveReadCandidate.symbol)}`,
);
if (
  !livePerpRes.ok
  || livePerpJson?.ok !== true
  || livePerpJson?.instrument?.instrument_id !== liveReadCandidate.instrument_id
  || livePerpJson?.instrument?.instrument_scope !== "exact_instrument"
  || livePerpJson?.market_data?.components?.market !== "fresh"
  || livePerpJson?.live_market_read?.schema_version !== "ravenos.perp_live_read.v1"
  || livePerpJson?.live_market_read?.role !== "live_market_read"
  || livePerpJson?.live_market_read?.source !== "hyperliquid_public_api"
  || livePerpJson?.live_market_read?.state !== "current"
  || Number(livePerpJson?.live_market_read?.input_count) < 4
  || !livePerpJson?.live_market_read?.signal_state
  || !livePerpJson?.live_market_read?.observed_at
  || livePerpJson?.raven_read?.role !== "live_market_read"
  || livePerpJson?.raven_context?.context_available !== false
  || livePerpJson?.decision_history_read !== null
  || livePerpJson?.live_market_read?.research_only !== true
  || livePerpJson?.live_market_read?.actionable !== false
  || livePerpJson?.live_market_read?.signing_available !== false
  || livePerpJson?.live_market_read?.submission_available !== false
  || livePerpJson?.execution?.signing_available !== false
  || livePerpJson?.execution?.submission_available !== false
) throw new Error("Exact Hyperliquid market without retained decision history did not receive a current live Raven read");
const livePerpNoLeakFindings = scanJsonValue(livePerpJson, "production:/api/perps/instrument:live-read");
if (livePerpNoLeakFindings.length) {
  const fields = livePerpNoLeakFindings.map((finding) => `${finding.path || "<root>"}:${finding.term}`).join(", ");
  throw new Error(`Production live Hyperliquid Raven read failed the public no-leak gate: ${fields}`);
}

const { res: onchainPulseRes, json: onchainPulseJson } = await fetchJson(
  "/api/onchain/trending?chains=base,ethereum,robinhood&duration=5m",
);
const pulseRows = onchainPulseJson?.rows;
if (
  !onchainPulseRes.ok
  || onchainPulseJson?.schema_version !== "ravenos.onchain_market_pulse.v1"
  || onchainPulseJson?.safe_public !== true
  || onchainPulseJson?.freshness?.state !== "current"
  || onchainPulseJson?.provenance?.raven_signal !== false
  || !Array.isArray(pulseRows)
  || !["base", "ethereum", "robinhood"].every((chain) => pulseRows.some((row) => (
    row?.chain_id === chain
    && row?.identity_scope === "exact_pool"
    && row?.source_type === "market_activity"
    && row?.instrument_id === `${chain}:pool:${row?.pool_address}`
    && row?.execution_available === false
  )))
  || onchainPulseJson?.execution_boundary?.signing_available !== false
  || onchainPulseJson?.execution_boundary?.submission_available !== false
) throw new Error("/api/onchain/trending did not return current exact-pool Base, Ethereum, and Robinhood Chain activity");

if (requireJupiterVelocity) {
  const { res: solanaVelocityRes, json: solanaVelocityJson } = await fetchJson(
    "/api/onchain/trending?chains=solana&duration=5m",
  );
  const velocityRows = Array.isArray(solanaVelocityJson?.rows)
    ? solanaVelocityJson.rows.filter((row) => row?.source_type === "jupiter_velocity")
    : [];
  if (
    !solanaVelocityRes.ok
    || solanaVelocityJson?.provenance?.role !== "token_velocity_plus_exact_pool_market_activity"
    || solanaVelocityJson?.discovery_lanes?.jupiter_velocity !== true
    || !velocityRows.length
    || velocityRows.some((row) => (
      row?.chain_id !== "solana"
      || row?.identity_scope !== "exact_pool"
      || row?.instrument_id !== `solana:pool:${row?.pool_address}`
      || row?.evidence_scope !== "exact_token_flow_plus_exact_pool_route"
      || row?.jupiter?.category !== "toptrending"
      || row?.jupiter?.metric_scope !== "exact_token"
      || row?.jupiter?.route_scope !== "best_current_exact_pool"
      || row?.research_only !== true
      || row?.execution_available !== false
    ))
  ) throw new Error("/api/onchain/trending did not return Jupiter Velocity tokens bound to current exact Solana pools");
  const solanaVelocityFindings = scanJsonValue(solanaVelocityJson, "production:/api/onchain/trending:solana-velocity");
  if (solanaVelocityFindings.length) {
    const fields = solanaVelocityFindings.map((finding) => `${finding.path || "<root>"}:${finding.term}`).join(", ");
    throw new Error(`Production Jupiter Velocity response failed the public no-leak gate: ${fields}`);
  }
  const terminalRow = velocityRows.find((row) => (
    row?.pool_address
    && row?.token_address
    && row?.quote_token_address
    && Number(row?.market?.market_age_seconds) >= 7_200
  )) || velocityRows[0];
  const terminalParams = new URLSearchParams({
    market: "crypto_spot",
    asset: `${terminalRow.symbol}/${terminalRow.quote_symbol || "SOL"}`,
    timeframe: "1m",
    limit: "240",
    chain: "solana",
    pair_address: terminalRow.pool_address,
    token_address: terminalRow.token_address,
    quote_address: terminalRow.quote_token_address,
    instrument_scope: "exact_pool",
  });
  const { res: terminalRes, json: terminalEnvelope } = await fetchJson(`/api/terminal/chart?${terminalParams.toString()}`);
  const terminalPayload = terminalEnvelope?.data || terminalEnvelope;
  const velocityContext = terminalPayload?.market_anatomy?.raven_context;
  if (
    !terminalRes.ok
    || terminalPayload?.ok !== true
    || terminalPayload?.instrument?.pool_address !== terminalRow.pool_address
    || terminalPayload?.instrument?.token_address !== terminalRow.token_address
    || velocityContext?.schema_version !== "ravenos.spot_market_context.v1"
    || velocityContext?.state !== "current"
    || velocityContext?.evidence_scope !== "exact_token"
    || velocityContext?.selected_pool_address !== terminalRow.pool_address
    || velocityContext?.evidence_pool_address !== null
    || velocityContext?.token_address !== terminalRow.token_address
    || velocityContext?.research_only !== true
    || velocityContext?.signing_available !== false
    || velocityContext?.submission_available !== false
    || !terminalPayload?.market_anatomy?.current_activity
  ) throw new Error("Jupiter Velocity row did not hand current token flow into its exact-pool Terminal");
}

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

const { res: accountSnapshotRes, json: accountSnapshotJson } = await fetchJson("/api/trade/account-snapshot", {
  method: "POST",
  body: { address: "0x000000000000000000000000000000000000dead" },
});
if (
  !accountSnapshotRes.ok
  || accountSnapshotJson?.schema_version !== "ravenos.hyperliquid_account_snapshot.v1"
  || accountSnapshotJson?.account?.address !== "0x000000000000000000000000000000000000dead"
  || accountSnapshotJson?.account?.ownership_asserted !== false
  || accountSnapshotJson?.account?.persisted !== false
  || !Array.isArray(accountSnapshotJson?.positions)
  || !Array.isArray(accountSnapshotJson?.balances)
  || !Array.isArray(accountSnapshotJson?.open_orders)
  || !Array.isArray(accountSnapshotJson?.fills)
  || accountSnapshotJson?.privacy?.transaction_hashes_exposed !== false
  || accountSnapshotJson?.privacy?.provider_order_ids_exposed !== false
  || accountSnapshotJson?.execution_boundary?.signing_available !== false
  || accountSnapshotJson?.execution_boundary?.submission_available !== false
) throw new Error("/api/trade/account-snapshot did not preserve its ephemeral read-only boundary");
const accountSnapshotText = JSON.stringify(accountSnapshotJson);
if (/"(?:hash|oid|tid|cloid)"\s*:/.test(accountSnapshotText)) {
  throw new Error("Production public account snapshot exposed a venue transaction or order identifier");
}
const accountSnapshotNoLeakFindings = scanJsonValue(accountSnapshotJson, "production:/api/trade/account-snapshot");
if (accountSnapshotNoLeakFindings.length) {
  const fields = accountSnapshotNoLeakFindings.map((finding) => `${finding.path || "<root>"}:${finding.term}`).join(", ");
  throw new Error(`Production public account snapshot failed the public no-leak gate: ${fields}`);
}

const { res: accountScenarioRes, json: accountScenarioJson } = await fetchJson("/api/trade/account-scenario", {
  method: "POST",
  body: {
    address: "0x000000000000000000000000000000000000dead",
    instrument_id: "hyperliquid:perp:SOL",
    side: "long",
    order_type: "market",
    notional_usdc: 500,
    leverage: 3,
    margin_mode: "cross",
    reduce_only: false,
    max_impact_bps: 100,
  },
});
if (
  !accountScenarioRes.ok
  || accountScenarioJson?.ok !== true
  || accountScenarioJson?.schema_version !== "ravenos.hyperliquid_account_scenario.v1"
  || accountScenarioJson?.instrument?.instrument_id !== "hyperliquid:perp:SOL"
  || accountScenarioJson?.account_context?.address !== "0x000000000000000000000000000000000000dead"
  || accountScenarioJson?.account_context?.ownership_asserted !== false
  || !accountScenarioJson?.position_effect?.effect
  || !Number.isFinite(Number(accountScenarioJson?.fee_estimate?.account_fee_rate))
  || !accountScenarioJson?.margin_check?.state
  || accountScenarioJson?.review?.prepared_payload_included !== false
  || accountScenarioJson?.execution_boundary?.prepared_order_available !== false
  || accountScenarioJson?.execution_boundary?.wallet_confirmation_available !== false
  || accountScenarioJson?.execution_boundary?.signing_available !== false
  || accountScenarioJson?.execution_boundary?.submission_available !== false
) throw new Error("/api/trade/account-scenario did not preserve exact account/market binding and the non-execution boundary");
const accountScenarioText = JSON.stringify(accountScenarioJson);
if (/"(?:hash|oid|tid|cloid)"\s*:/.test(accountScenarioText)) {
  throw new Error("Production account scenario exposed a venue transaction or order identifier");
}
const accountScenarioNoLeakFindings = scanJsonValue(accountScenarioJson, "production:/api/trade/account-scenario");
if (accountScenarioNoLeakFindings.length) {
  const fields = accountScenarioNoLeakFindings.map((finding) => `${finding.path || "<root>"}:${finding.term}`).join(", ");
  throw new Error(`Production account scenario failed the public no-leak gate: ${fields}`);
}

const { res: accountHistoryRes, json: accountHistoryJson } = await fetchJson("/api/trade/account-history", {
  method: "POST",
  body: { address: "0x000000000000000000000000000000000000dead", kind: "orders" },
});
if (
  !accountHistoryRes.ok
  || accountHistoryJson?.ok !== true
  || accountHistoryJson?.schema_version !== "ravenos.hyperliquid_account_history.v1"
  || accountHistoryJson?.account?.address !== "0x000000000000000000000000000000000000dead"
  || accountHistoryJson?.account?.ownership_asserted !== false
  || accountHistoryJson?.account?.persisted !== false
  || !Array.isArray(accountHistoryJson?.orders)
  || accountHistoryJson?.privacy?.provider_order_ids_exposed !== false
  || accountHistoryJson?.execution_boundary?.cancellation_available !== false
  || accountHistoryJson?.execution_boundary?.signing_available !== false
  || accountHistoryJson?.execution_boundary?.submission_available !== false
) throw new Error("/api/trade/account-history did not preserve its bounded read-only boundary");
const accountHistoryText = JSON.stringify(accountHistoryJson);
if (/"(?:hash|oid|tid|cloid)"\s*:/.test(accountHistoryText)) {
  throw new Error("Production public account history exposed a venue transaction or order identifier");
}
const accountHistoryNoLeakFindings = scanJsonValue(accountHistoryJson, "production:/api/trade/account-history");
if (accountHistoryNoLeakFindings.length) {
  const fields = accountHistoryNoLeakFindings.map((finding) => `${finding.path || "<root>"}:${finding.term}`).join(", ");
  throw new Error(`Production public account history failed the public no-leak gate: ${fields}`);
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

for (const chain of ["base", "ethereum", "robinhood"]) {
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
