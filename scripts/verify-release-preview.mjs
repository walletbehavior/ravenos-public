import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { onchainChartProviderEnv } from "./lib/onchain-chart-provider-env.mjs";

const baseUrl = String(process.argv[2] || "").replace(/\/+$/, "");
const bundleRoot = resolve(process.argv[3] || "");
if (!baseUrl.startsWith("https://") || !bundleRoot) {
  throw new Error("Usage: node scripts/verify-release-preview.mjs <https-preview-url> <release-bundle-dir>");
}

const release = JSON.parse(readFileSync(join(bundleRoot, "assets/ravenos_release.json"), "utf8"));
const assetManifest = JSON.parse(readFileSync(join(bundleRoot, "assets/ravenos_asset_manifest.json"), "utf8"));
const routeManifest = JSON.parse(readFileSync(join(bundleRoot, "assets/public_routes.json"), "utf8"));
const stageReceipt = JSON.parse(readFileSync(join(bundleRoot, "stage-receipt.json"), "utf8"));
const results = [];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function capture(path, { expectedStatus = 200 } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "cache-control": "no-cache", "user-agent": "RavenOS-Release-Preflight/1.0" },
    redirect: "manual",
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const record = {
    path,
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
if (health.intelligence_freshness?.state !== "fresh") throw new Error("/api/health does not report fresh current intelligence");
if (health.projection_health?.state !== "operational") throw new Error("/api/health does not report an operational projection");
if (health.projection_health?.source_status !== "current_public_origin") throw new Error("/api/health is not reading current-origin status");
if (health.projection_health?.manifest_status !== "current_public_origin") throw new Error("/api/health is not reading the current-origin manifest");
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
  || flags?.signing_available !== false
  || flags?.submission_available !== false
  || flags?.fees_enabled !== false
) {
  throw new Error("Customer execution boundary is not read-only and non-signing");
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
const chart = chartEnvelope?.data || chartEnvelope;
if (
  chart?.ok !== true
  || chart?.market_identity !== `${chartAnchor.chain}:${chartAnchor.pair}`
  || chart?.instrument?.pool_address !== chartAnchor.pair
  || chart?.candle_series?.provider !== "coingecko_onchain"
  || chart?.candle_series?.role !== "base_ohlcv"
  || chart?.candle_series?.raven_observations_are_candles !== false
  || chart?.provider_selection?.selected !== "coingecko_onchain"
  || chart?.provider_selection?.fallback !== false
  || chart?.lineage?.provider_plan !== "demo"
  || chart?.lineage?.empty_interval_policy !== "provider_previous_close_zero_volume"
  || chart?.attribution?.required !== true
  || chart?.attribution?.label !== "Data provided by CoinGecko"
  || chart?.attribution?.url !== "https://www.coingecko.com/"
  || !["verified_current", "verified_with_visible_staleness"].includes(chart?.chart_readiness?.state)
  || chart?.chart_readiness?.one_minute_requirement !== "verified"
  || !Array.isArray(chart?.candles)
  || chart.candles.length < 120
) {
  throw new Error("Isolated preview did not return the exact keyed CoinGecko Demo one-minute chart contract");
}
const localProviderEnv = onchainChartProviderEnv(dirname(dirname(bundleRoot)));
const localProviderSecret = String(localProviderEnv.ONCHAIN_CHART_PROVIDER_SECRET || "").trim();
if (localProviderSecret && chartCapture.text.includes(localProviderSecret)) {
  throw new Error("Server-only chart-provider secret entered the preview response");
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
  projection_health: health.projection_health.state,
  opportunity_source: opportunity.delivery.source,
  opportunity_fallback: opportunity.delivery.fallback,
  opportunity_freshness: opportunity.delivery.freshness_state,
  exact_instrument_verified: selectedRow.instrument_id,
  provider_attribution_verified: true,
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
