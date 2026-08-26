import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { onchainChartProviderEnv } from "./lib/onchain-chart-provider-env.mjs";
import { scanJsonValue } from "./validate-public-no-leak.mjs";

const baseUrl = String(process.argv[2] || "").replace(/\/+$/, "");
const bundleRoot = resolve(process.argv[3] || "");
if (!baseUrl.startsWith("https://") || !bundleRoot) {
  throw new Error("Usage: node scripts/verify-release-preview.mjs <https-preview-url> <release-bundle-dir>");
}

const release = JSON.parse(readFileSync(join(bundleRoot, "assets/ravenos_release.json"), "utf8"));
const packageManifest = JSON.parse(readFileSync(join(bundleRoot, "release-package.json"), "utf8"));
const assetManifest = JSON.parse(readFileSync(join(bundleRoot, "assets/ravenos_asset_manifest.json"), "utf8"));
const routeManifest = JSON.parse(readFileSync(join(bundleRoot, "assets/public_routes.json"), "utf8"));
const stageReceipt = JSON.parse(readFileSync(join(bundleRoot, "stage-receipt.json"), "utf8"));
const results = [];
const capturedBodies = [];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function capture(path, { expectedStatus = 200, method = "GET", body = undefined } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "cache-control": "no-cache",
      "user-agent": "RavenOS-Release-Preflight/1.0",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  capturedBodies.push({ path, text: bytes.toString("utf8") });
  const record = {
    path,
    method,
    status: response.status,
    content_type: response.headers.get("content-type"),
    cache_control: response.headers.get("cache-control"),
    release_header: response.headers.get("x-ravenos-release-id"),
    worker_version_header: response.headers.get("x-ravenos-worker-version"),
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
  results.push(record);
  if (expectedStatus !== null && response.status !== expectedStatus) throw new Error(`${path} returned ${response.status}, expected ${expectedStatus}`);
  return { response, bytes, text: bytes.toString("utf8"), record };
}

async function captureReady(path, { attempts = 30, delayMs = 1000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const captured = await capture(path, { expectedStatus: null });
    if (captured.response.status === 200) return captured;
    if (![404, 522, 523, 530].includes(captured.response.status) || attempt === attempts) {
      throw new Error(`${path} returned ${captured.response.status} during preview readiness`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
  }
  throw new Error(`${path} did not become ready`);
}

const buildCapture = await captureReady("/api/build");
const buildIdentity = JSON.parse(buildCapture.text);
if (!buildIdentity.ok || buildIdentity.cohesion?.state !== "coherent") throw new Error("/api/build did not report a coherent release");
if (buildIdentity.release?.release_id !== release.release_id) throw new Error("/api/build release ID mismatch");
if (stageReceipt.worker_version_tag !== release.release_id) throw new Error("Cloudflare API version tag does not match release ID");
if (buildIdentity.worker?.version_id !== stageReceipt.worker_version_id) throw new Error("Runtime Worker version ID does not match the staged version");
if (buildIdentity.worker?.expected_version_tag !== release.release_id) throw new Error("Runtime expected version tag does not match release ID");
if (buildIdentity.worker?.version_tag && buildIdentity.worker.version_tag !== release.release_id) throw new Error("Runtime Worker version tag conflicts with release ID");
if (!/no-store/i.test(buildCapture.record.cache_control || "")) throw new Error("/api/build must be no-store");

for (const controlPath of ["/ravenos_release.json", "/ravenos_asset_manifest.json", "/ravenos_deploy_manifest.json"]) {
  const captureResult = await capture(controlPath);
  if (!/no-store/i.test(captureResult.record.cache_control || "")) throw new Error(`${controlPath} must be no-store`);
  if (captureResult.record.release_header !== release.release_id) throw new Error(`${controlPath} release header mismatch`);
}

const referencedAssets = new Set();
for (const route of routeManifest.routes || []) {
  if (!route.public) continue;
  const captureResult = await capture(route.route || "/");
  if (!captureResult.text.includes(`name="ravenos-release-id" content="${release.release_id}"`)) {
    throw new Error(`${route.route} is missing its release meta tag`);
  }
  if (/immutable/i.test(captureResult.record.cache_control || "")) throw new Error(`${route.route} HTML must not be immutable`);
  for (const match of captureResult.text.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)) referencedAssets.add(match[1]);
}

const assetsByUrl = new Map(Object.values(assetManifest.assets || {}).map((entry) => [entry.url, entry]));
for (const assetUrl of referencedAssets) {
  const expected = assetsByUrl.get(assetUrl);
  if (!expected) throw new Error(`HTML references unmanifested asset ${assetUrl}`);
  const captureResult = await capture(assetUrl);
  if (captureResult.record.sha256 !== expected.sha256) throw new Error(`Asset body hash mismatch: ${assetUrl}`);
  if (!/max-age=31536000/i.test(captureResult.record.cache_control || "") || !/immutable/i.test(captureResult.record.cache_control || "")) {
    throw new Error(`Asset is not immutable: ${assetUrl}`);
  }
}

const healthCapture = await capture("/api/health");
const health = JSON.parse(healthCapture.text);
if (!health || typeof health !== "object") throw new Error("/api/health returned invalid JSON");
if (health.status !== "ok") throw new Error("/api/health does not report a healthy complete product");
if (health.market_data_health?.state !== "fresh") throw new Error("/api/health does not report fresh market data");
if (health.intelligence_freshness?.state !== "fresh") throw new Error("/api/health does not report fresh current intelligence");
if (!["fresh", "delayed"].includes(health.atlas_health?.state) || health.atlas_health?.operational !== true) {
  throw new Error("/api/health does not report usable fresh-or-delayed Atlas context");
}
if (health.raven_read_health?.state !== "fresh") throw new Error("/api/health does not report fresh deterministic Raven Reads");
if (health.narrator_freshness?.state !== "not_required" || health.narrator_freshness?.blocking !== false) {
  throw new Error("/api/health does not classify the retired narrator sidecar as non-blocking");
}
if (health.projection_health?.state !== "operational") throw new Error("/api/health does not report an operational projection");
if (health.publisher_health?.state !== "operational") throw new Error("/api/health does not report an operational public publisher");
if (health.projection_health?.source_status !== "current_public_origin") throw new Error("/api/health is not reading current-origin status");
if (health.projection_health?.manifest_status !== "current_public_origin") throw new Error("/api/health is not reading the current-origin manifest");
if (
  health.execution_health?.state !== "disabled"
  || health.execution_health?.signing_available !== false
  || health.execution_health?.submission_available !== false
) throw new Error("/api/health does not preserve the disabled execution boundary");
const opportunityCapture = await capture("/api/opportunity");
const opportunity = JSON.parse(opportunityCapture.text);
if (opportunity?.delivery?.fallback !== false || opportunity?.delivery?.source !== "current_public_origin") {
  throw new Error("/api/opportunity is not using the current public origin");
}
if (opportunity?.delivery?.freshness_state !== "fresh" || opportunity?.census?.source_state !== "current") {
  throw new Error("/api/opportunity is not current and fresh");
}
const selectedRow = opportunity?.selected_opportunity;
if (!selectedRow?.instrument_id || !selectedRow?.instrument) throw new Error("Current Census has no exact instrument to verify");
const selectionCapture = await capture(`/api/opportunity?instrument_id=${encodeURIComponent(selectedRow.instrument_id)}&instrument=${encodeURIComponent(selectedRow.instrument)}`);
const selection = JSON.parse(selectionCapture.text);
if (
  selection?.selection?.state !== "matched"
  || selection?.selection?.silently_replaced !== false
  || selection?.selected_opportunity?.instrument_id !== selectedRow.instrument_id
) {
  throw new Error("Explicit Census instrument selection was not preserved exactly");
}
const flagsCapture = await capture("/api/trade/flags");
const flags = JSON.parse(flagsCapture.text);
if (
  flags?.quote_only !== true
  || flags?.market_preview_available !== true
  || !flags?.market_preview_markets?.includes("hyperliquid_perpetual")
  || flags?.order_plan_available !== true
  || !flags?.order_plan_markets?.includes("hyperliquid_perpetual")
  || !["market", "limit", "trigger"].every((orderType) => flags?.order_plan_types?.includes(orderType))
  || flags?.public_account_view_available !== true
  || !flags?.public_account_view_venues?.includes("hyperliquid")
  || flags?.signing_available !== false
  || flags?.submission_available !== false
  || flags?.fees_enabled !== false
) {
  throw new Error("Customer execution boundary is not read-only and non-signing");
}
const marketPreviewCapture = await capture("/api/trade/market-preview", {
  method: "POST",
  body: {
    instrument_id: "hyperliquid:perp:SOL",
    side: "long",
    notional_usdc: 500,
    leverage: 3,
    max_impact_bps: 100,
  },
});
const marketPreview = JSON.parse(marketPreviewCapture.text);
if (
  marketPreview?.ok !== true
  || marketPreview?.schema_version !== "ravenos.hyperliquid_market_preview.v1"
  || marketPreview?.instrument?.instrument_id !== "hyperliquid:perp:SOL"
  || marketPreview?.instrument?.identity_scope !== "exact_instrument"
  || marketPreview?.provenance?.provider !== "Hyperliquid"
  || marketPreview?.provenance?.source !== "live_l2_book"
  || marketPreview?.provenance?.exact_identity !== true
  || marketPreview?.review?.review_ready !== false
  || marketPreview?.execution_boundary?.prepared_order_available !== false
  || marketPreview?.execution_boundary?.signing_available !== false
  || marketPreview?.execution_boundary?.submission_available !== false
) {
  throw new Error("Hyperliquid live-book preview did not preserve exact identity and the non-execution boundary");
}
const marketPreviewNoLeakFindings = scanJsonValue(marketPreview, "preview:/api/trade/market-preview");
if (marketPreviewNoLeakFindings.length) {
  const fields = marketPreviewNoLeakFindings.map((finding) => `${finding.path || "<root>"}:${finding.term}`).join(", ");
  throw new Error(`Hyperliquid market preview failed the public no-leak gate: ${fields}`);
}

const orderPlanCapture = await capture("/api/trade/order-plan", {
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
const orderPlan = JSON.parse(orderPlanCapture.text);
if (
  orderPlan?.ok !== true
  || orderPlan?.schema_version !== "ravenos.hyperliquid_order_plan.v1"
  || orderPlan?.instrument?.instrument_id !== "hyperliquid:perp:SOL"
  || orderPlan?.instrument?.identity_scope !== "exact_instrument"
  || orderPlan?.intent?.order_type !== "market"
  || orderPlan?.entry_model?.state !== "current_book_fill_estimate"
  || orderPlan?.provenance?.provider !== "Hyperliquid"
  || orderPlan?.provenance?.source !== "live_l2_book"
  || orderPlan?.provenance?.exact_identity !== true
  || orderPlan?.review?.prepared_payload_included !== false
  || orderPlan?.execution_boundary?.prepared_order_available !== false
  || orderPlan?.execution_boundary?.signing_available !== false
  || orderPlan?.execution_boundary?.submission_available !== false
) {
  throw new Error("Hyperliquid order plan did not preserve exact identity and the non-execution boundary");
}
const orderPlanNoLeakFindings = scanJsonValue(orderPlan, "preview:/api/trade/order-plan");
if (orderPlanNoLeakFindings.length) {
  const fields = orderPlanNoLeakFindings.map((finding) => `${finding.path || "<root>"}:${finding.term}`).join(", ");
  throw new Error(`Hyperliquid order plan failed the public no-leak gate: ${fields}`);
}

const accountSnapshotCapture = await capture("/api/trade/account-snapshot", {
  method: "POST",
  body: { address: "0x000000000000000000000000000000000000dead" },
});
const accountSnapshot = JSON.parse(accountSnapshotCapture.text);
if (
  accountSnapshot?.ok !== true
  || accountSnapshot?.schema_version !== "ravenos.hyperliquid_account_snapshot.v1"
  || accountSnapshot?.account?.address !== "0x000000000000000000000000000000000000dead"
  || accountSnapshot?.account?.ownership_asserted !== false
  || accountSnapshot?.account?.persisted !== false
  || !Array.isArray(accountSnapshot?.positions)
  || !Array.isArray(accountSnapshot?.open_orders)
  || !Array.isArray(accountSnapshot?.fills)
  || accountSnapshot?.privacy?.transaction_hashes_exposed !== false
  || accountSnapshot?.privacy?.provider_order_ids_exposed !== false
  || accountSnapshot?.execution_boundary?.signing_available !== false
  || accountSnapshot?.execution_boundary?.submission_available !== false
) {
  throw new Error("Hyperliquid public account snapshot did not preserve its ephemeral read-only boundary");
}
if (/"(?:hash|oid|tid|cloid)"\s*:/.test(accountSnapshotCapture.text)) {
  throw new Error("Hyperliquid public account snapshot exposed a venue transaction or order identifier");
}
const accountSnapshotNoLeakFindings = scanJsonValue(accountSnapshot, "preview:/api/trade/account-snapshot");
if (accountSnapshotNoLeakFindings.length) {
  const fields = accountSnapshotNoLeakFindings.map((finding) => `${finding.path || "<root>"}:${finding.term}`).join(", ");
  throw new Error(`Hyperliquid public account snapshot failed the public no-leak gate: ${fields}`);
}

const atlasFeaturedCapture = await capture("/api/atlas/featured?limit=8");
const atlasFeatured = JSON.parse(atlasFeaturedCapture.text);
if (
  atlasFeatured?.schema_version !== "atlas_featured_state_v1"
  || atlasFeatured?.safe_public !== true
  || !Array.isArray(atlasFeatured?.sections)
  || Object.values(atlasFeatured?.execution_boundary || {}).some(Boolean)
) {
  throw new Error("Atlas featured state did not preserve its safe public contract");
}
const atlasSearchCapture = await capture("/api/atlas/search?q=SPY&limit=20");
const atlasSearch = JSON.parse(atlasSearchCapture.text);
const atlasSpy = (atlasSearch?.results || []).find((row) => row?.entity_id === "etf:us:SPY");
if (!atlasSpy || atlasSearch?.quote_fetch_triggered !== false || atlasSearch?.observer_created !== false) {
  throw new Error("Atlas local-first search did not resolve exact SPY metadata without hydration");
}
const atlasEntityCapture = await capture("/api/atlas/entity?entity_id=etf%3Aus%3ASPY");
const atlasEntity = JSON.parse(atlasEntityCapture.text);
if (
  atlasEntity?.entity?.entity_id !== "etf:us:SPY"
  || atlasEntity?.snapshot?.state !== "display_restricted"
  || atlasEntity?.snapshot?.data !== null
  || Object.values(atlasEntity?.execution_boundary || {}).some(Boolean)
) {
  throw new Error("Atlas listed detail did not enforce exact identity and Tradier display rights");
}
const atlasOptionsCapture = await capture("/api/atlas/options/expirations?entity_id=etf%3Aus%3ASPY");
const atlasOptions = JSON.parse(atlasOptionsCapture.text);
if (
  atlasOptions?.entity_id !== "etf:us:SPY"
  || atlasOptions?.full_chain_fetched !== false
  || atlasOptions?.options?.state !== "display_restricted"
  || atlasOptions?.options?.data !== null
) {
  throw new Error("Atlas lazy options boundary did not remain restricted and chain-free");
}
const fredHistoryCapture = await capture("/api/atlas/history?entity_id=fred%3ADGS10&limit=120");
const fredHistory = JSON.parse(fredHistoryCapture.text);
if (
  fredHistory?.entity_id !== "fred:DGS10"
  || fredHistory?.history?.state !== "available"
  || fredHistory?.history?.delay_class !== "periodic"
  || !Array.isArray(fredHistory?.history?.data?.observations)
  || fredHistory.history.data.observations.length < 2
) {
  throw new Error("Atlas FRED periodic history was not available through the staged Worker");
}
const secFilingsCapture = await capture("/api/atlas/sec/filings?entity_id=equity%3Aus%3AAAPL&limit=100");
const secFilings = JSON.parse(secFilingsCapture.text);
if (
  secFilings?.entity_id !== "equity:us:AAPL"
  || secFilings?.metadata_is_not_a_filing_summary !== true
  || secFilings?.filings?.state !== "available"
  || !Array.isArray(secFilings?.filings?.data)
  || !secFilings.filings.data.some((row) => row?.form === "4" && String(row?.filing_url || "").startsWith("https://www.sec.gov/Archives/"))
) {
  throw new Error("Atlas SEC filing metadata was not available with an original EDGAR link");
}
const secInsidersCapture = await capture("/api/atlas/sec/insiders?entity_id=equity%3Aus%3AAAPL&limit=3");
const secInsiders = JSON.parse(secInsidersCapture.text);
if (
  !Array.isArray(secInsiders?.events)
  || secInsiders.events.length < 1
  || !secInsiders.events.every((row) => row?.transaction_at && row?.filed_at && String(row?.original_document || "").startsWith("https://www.sec.gov/Archives/"))
  || secInsiders?.market_enrichment_active !== false
  || secInsiders?.options_enrichment_active !== false
  || secInsiders?.misconduct_inference_emitted !== false
) {
  throw new Error("Atlas Form 4 normalization did not preserve both clocks and its non-inference boundary");
}
const eiaHistoryCapture = await capture("/api/atlas/history?entity_id=eia%3Apetroleum.pri.spt&limit=120");
const eiaHistory = JSON.parse(eiaHistoryCapture.text);
const eiaDataset = eiaHistory?.dataset;
if (eiaHistory?.state !== "facet_selection_required" || !Array.isArray(eiaDataset?.facets) || !Array.isArray(eiaDataset?.frequencies) || !Array.isArray(eiaDataset?.data_fields)) {
  throw new Error("Atlas EIA detail fetched observations before an exact facet selection");
}
const seriesFacet = eiaDataset.facets.find((row) => row?.id === "series");
const eiaFrequency = eiaDataset.frequencies[0]?.id;
const eiaDataField = eiaDataset.data_fields[0];
if (!seriesFacet || !eiaFrequency || !eiaDataField) throw new Error("Atlas EIA exact-series controls are incomplete");
const eiaFacetsCapture = await capture("/api/atlas/eia/facets?entity_id=eia%3Apetroleum.pri.spt&facet_id=series&limit=25");
const eiaFacets = JSON.parse(eiaFacetsCapture.text);
const eiaFacetValue = eiaFacets?.facets?.data?.values?.[0]?.id;
if (!eiaFacetValue || eiaFacets?.observations_fetched !== false) throw new Error("Atlas EIA facet lookup was not bounded metadata-only");
const eiaParams = new URLSearchParams({
  entity_id: "eia:petroleum.pri.spt",
  frequency: eiaFrequency,
  data_field: eiaDataField,
  facet_id: "series",
  facet_value: eiaFacetValue,
  limit: "120",
});
const eiaSeriesCapture = await capture(`/api/atlas/eia/series?${eiaParams.toString()}`);
const eiaSeries = JSON.parse(eiaSeriesCapture.text);
if (
  eiaSeries?.selection_exact !== true
  || eiaSeries?.series?.delay_class !== "periodic"
  || !Array.isArray(eiaSeries?.series?.data?.observations)
  || eiaSeries.series.data.observations.length < 2
) {
  throw new Error("Atlas exact EIA series was not hydrated as a bounded periodic series");
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
const chartCapture = await capture(`/api/terminal/chart?${chartParams.toString()}`);
const chartEnvelope = JSON.parse(chartCapture.text);
const chartNoLeakFindings = scanJsonValue(chartEnvelope, "preview:/api/terminal/chart");
if (chartNoLeakFindings.length) {
  const fields = chartNoLeakFindings.map((finding) => `${finding.path || "<root>"}:${finding.term}`).join(", ");
  throw new Error(`Isolated preview chart response failed the public no-leak gate: ${fields}`);
}
const chart = chartEnvelope?.data || chartEnvelope;
const chartProviderContract = packageManifest.onchain_chart_provider || {};
const expectedChartPlan = chartProviderContract.production_promotion_eligible === true
  ? chartProviderContract.production_provider_plan
  : chartProviderContract.preview_provider_plan;
if (
  chart?.ok !== true
  || chart?.market_identity !== `${chartAnchor.chain}:${chartAnchor.pair}`
  || chart?.instrument?.pool_address !== chartAnchor.pair
  || chart?.candle_series?.provider !== "coingecko_onchain"
  || chart?.candle_series?.role !== "base_ohlcv"
  || chart?.candle_series?.raven_observations_are_candles !== false
  || chart?.provider_selection?.selected !== "coingecko_onchain"
  || chart?.provider_selection?.fallback !== false
  || chart?.lineage?.provider_plan !== expectedChartPlan
  || (chartProviderContract.production_promotion_eligible === true && chart?.lineage?.commercial_state !== "commercial_qualified")
  || (chartProviderContract.production_promotion_eligible === true && chart?.provider_selection?.production_state !== "qualified_for_production")
  || chart?.lineage?.empty_interval_policy !== "provider_previous_close_zero_volume"
  || chart?.attribution?.required !== true
  || chart?.attribution?.label !== "Data provided by CoinGecko"
  || chart?.attribution?.url !== "https://www.coingecko.com/"
  || !["verified_current", "verified_with_visible_staleness"].includes(chart?.chart_readiness?.state)
  || chart?.chart_readiness?.one_minute_requirement !== "verified"
  || !Array.isArray(chart?.candles)
  || chart.candles.length < 120
) {
  throw new Error(`Isolated preview did not return the exact keyed CoinGecko ${expectedChartPlan || "configured"} one-minute chart contract`);
}

const onchainPulseCapture = await capture("/api/onchain/trending?chains=base,ethereum&duration=5m");
const onchainPulse = JSON.parse(onchainPulseCapture.text);
const onchainPulseFindings = scanJsonValue(onchainPulse, "preview:/api/onchain/trending");
if (onchainPulseFindings.length) {
  const fields = onchainPulseFindings.map((finding) => `${finding.path || "<root>"}:${finding.term}`).join(", ");
  throw new Error(`Isolated preview on-chain market pulse failed the public no-leak gate: ${fields}`);
}
if (
  onchainPulse?.schema_version !== "ravenos.onchain_market_pulse.v1"
  || onchainPulse?.safe_public !== true
  || onchainPulse?.freshness?.state !== "current"
  || onchainPulse?.provenance?.raven_signal !== false
  || onchainPulse?.execution_boundary?.signing_available !== false
  || onchainPulse?.execution_boundary?.submission_available !== false
  || !Array.isArray(onchainPulse?.rows)
) {
  throw new Error("Isolated preview on-chain market pulse contract is incomplete");
}
const evmChartRows = ["base", "ethereum"].map((chain) => onchainPulse.rows.find((row) => (
  row?.chain_id === chain
  && row?.identity_scope === "exact_pool"
  && row?.source_type === "market_activity"
  && row?.instrument_id === `${chain}:pool:${row?.pool_address}`
)));
if (evmChartRows.some((row) => !row)) {
  throw new Error("Isolated preview did not return exact-pool Base and Ethereum activity");
}
for (const row of evmChartRows) {
  const params = new URLSearchParams({
    market: "crypto_spot",
    asset: `${row.symbol}/${row.quote_symbol}`,
    timeframe: "1m",
    limit: "240",
    chain: row.chain_id,
    pair_address: row.pool_address,
    token_address: row.token_address,
    quote_address: row.quote_token_address,
    instrument_scope: "exact_pool",
  });
  const evmChartCapture = await capture(`/api/terminal/chart?${params.toString()}`);
  const evmChartEnvelope = JSON.parse(evmChartCapture.text);
  const evmChart = evmChartEnvelope?.data || evmChartEnvelope;
  if (
    evmChart?.ok !== true
    || evmChart?.market_identity !== `${row.chain_id}:${row.pool_address}`
    || evmChart?.instrument?.pool_address !== row.pool_address
    || evmChart?.instrument?.token_address?.toLowerCase() !== row.token_address.toLowerCase()
    || evmChart?.candle_series?.provider !== "coingecko_onchain"
    || evmChart?.candle_series?.raven_observations_are_candles !== false
    || !Array.isArray(evmChart?.candles)
    || evmChart.candles.length < 120
  ) {
    throw new Error(`Isolated preview ${row.chain_id} market pulse row did not open a dense exact-pool one-minute chart`);
  }
}

const localProviderEnv = onchainChartProviderEnv(dirname(dirname(bundleRoot)));
const localProviderSecret = String(localProviderEnv.ONCHAIN_CHART_PROVIDER_SECRET || "").trim();
if (localProviderSecret && chartCapture.text.includes(localProviderSecret)) {
  throw new Error("Server-only chart-provider secret entered the preview response");
}
const serverOnlyValues = new Set([
  localProviderEnv.ONCHAIN_CHART_PROVIDER_SECRET,
  localProviderEnv.RAVENOS_PUBLIC_ORIGIN_TOKEN,
  localProviderEnv.RAVENOS_SPOT_CHART_ORIGIN_TOKEN,
  localProviderEnv.COINGECKO_API_KEY,
  localProviderEnv.COINGECKO_PRO_API_KEY,
].map((value) => String(value || "").trim()).filter((value) => value.length >= 8));
for (const { path, text } of capturedBodies) {
  for (const secret of serverOnlyValues) {
    if (text.includes(secret)) throw new Error(`Server-only secret entered preview response ${path}`);
  }
}

const report = {
  schema_version: "ravenos.release_preview_verification.v1",
  ok: true,
  verified_at: new Date().toISOString(),
  base_url: baseUrl,
  release_id: release.release_id,
  worker_version_id: buildIdentity.worker.version_id,
  static_asset_manifest_sha256: release.static_asset_manifest_sha256,
  routes_verified: (routeManifest.routes || []).filter((route) => route.public).length,
  referenced_assets_verified: referencedAssets.size,
  health_status: health.status || null,
  intelligence_freshness: health.intelligence_freshness.state,
  market_data_health: health.market_data_health.state,
  atlas_health: health.atlas_health.state,
  raven_read_health: health.raven_read_health.state,
  projection_health: health.projection_health.state,
  publisher_health: health.publisher_health.state,
  opportunity_source: opportunity.delivery.source,
  opportunity_fallback: opportunity.delivery.fallback,
  opportunity_freshness: opportunity.delivery.freshness_state,
  exact_instrument_verified: selectedRow.instrument_id,
  provider_attribution_verified: true,
  onchain_market_pulse: {
    chains: evmChartRows.map((row) => row.chain_id),
    exact_pool_charts_verified: evmChartRows.length,
  },
  atlas_universe: {
    featured_sections: atlasFeatured.sections.length,
    search_identity: atlasSpy.entity_id,
    listed_values_restricted: atlasEntity.snapshot.state === "display_restricted",
    options_lazy_and_restricted: atlasOptions.full_chain_fetched === false,
    fred_observations: fredHistory.history.data.observations.length,
    sec_filings: secFilings.filings.data.length,
    sec_insider_events: secInsiders.events.length,
    eia_observations: eiaSeries.series.data.observations.length,
  },
  onchain_chart: {
    market_identity: chart.market_identity,
    provider: chart.candle_series.provider,
    provider_plan: chart.lineage.provider_plan,
    timeframe: chart.timeframe,
    bars: chart.candles.length,
    freshness_state: chart.freshness_state,
    readiness_state: chart.chart_readiness.state,
    fallback: chart.provider_selection.fallback,
  },
  execution_boundary: {
    quote_only: flags.quote_only,
    signing_available: flags.signing_available,
    submission_available: flags.submission_available,
  },
  captures: results,
};
writeFileSync(join(bundleRoot, "preview-verification.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
