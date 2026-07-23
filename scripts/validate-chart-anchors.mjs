import ravenosWorker from "../worker.mjs";
import { onchainChartProviderEnv } from "./lib/onchain-chart-provider-env.mjs";

const providerEnv = onchainChartProviderEnv(process.cwd());
const productionMode = process.argv.includes("--production");
const fullMatrix = productionMode || process.argv.includes("--full");
const allowKeylessDiagnostic = process.argv.includes("--allow-keyless-diagnostic")
  || String(providerEnv.RAVENOS_ALLOW_KEYLESS_GECKOTERMINAL_DIAGNOSTIC || "") === "1";
const providerKeyConfigured = Boolean(String(providerEnv.ONCHAIN_CHART_PROVIDER_SECRET || providerEnv.COINGECKO_PRO_API_KEY || "").trim());
const selectedProvider = String(providerEnv.ONCHAIN_CHART_PROVIDER || "").trim();
const providerPlan = String(providerEnv.ONCHAIN_CHART_PROVIDER_PLAN || "").trim().toLowerCase();
const providerCommercial = String(providerEnv.ONCHAIN_CHART_PROVIDER_COMMERCIAL || "").trim().toLowerCase() === "true";
const publicOriginConfigured = Boolean(String(providerEnv.RAVENOS_PUBLIC_ORIGIN_TOKEN || "").trim());
const providerOrder = String(providerEnv.RAVENOS_ONCHAIN_CHART_PROVIDER_ORDER || "dexpaprika,coingecko_onchain").trim();
const effectiveProviderOrder = selectedProvider
  ? [selectedProvider.toLowerCase() === "coingecko" ? "coingecko_onchain" : selectedProvider.toLowerCase()]
  : providerOrder.split(",").map((value) => value.trim()).filter(Boolean);
const productionProvider = String(providerEnv.RAVENOS_ONCHAIN_CHART_PRODUCTION_PROVIDER || "").trim();
const productionProviderQualified = String(providerEnv.RAVENOS_ONCHAIN_CHART_PRODUCTION_QUALIFIED || "") === "1";

if (productionMode && (!productionProvider || !productionProviderQualified || !providerCommercial || providerPlan === "demo")) {
  throw new Error("Production chart validation remains blocked until one exact-pool provider's commercial rights, anchor coverage, rate behavior, and server-side binding are qualified.");
}
if (productionMode && !publicOriginConfigured) {
  throw new Error("Production chart validation requires the server-only public-origin binding.");
}

const env = {
  ONCHAIN_CHART_PROVIDER: selectedProvider,
  ONCHAIN_CHART_PROVIDER_PLAN: providerPlan,
  ONCHAIN_CHART_PROVIDER_COMMERCIAL: String(providerCommercial),
  ONCHAIN_CHART_PROVIDER_SECRET: providerEnv.ONCHAIN_CHART_PROVIDER_SECRET,
  COINGECKO_PRO_API_KEY: providerEnv.COINGECKO_PRO_API_KEY,
  RAVENOS_ALLOW_KEYLESS_GECKOTERMINAL_DIAGNOSTIC: allowKeylessDiagnostic ? "1" : "0",
  RAVENOS_ONCHAIN_CHART_PROVIDER_ORDER: providerOrder,
  RAVENOS_PUBLIC_ORIGIN_TOKEN: providerEnv.RAVENOS_PUBLIC_ORIGIN_TOKEN,
  RAVENOS_PUBLIC_ORIGIN_URL: providerEnv.RAVENOS_PUBLIC_ORIGIN_URL,
  RAVENOS_SPOT_CHART_ORIGIN_TOKEN: providerEnv.RAVENOS_SPOT_CHART_ORIGIN_TOKEN,
  RAVENOS_SPOT_CHART_ORIGIN_URL: providerEnv.RAVENOS_SPOT_CHART_ORIGIN_URL,
};

const intervals = ["1m", "5m", "15m", "1h", "4h", "1d"];
const minimumBars = { "1m": 120, "5m": 120, "15m": 120, "1h": 120, "4h": 60, "1d": 14 };
const anchors = [
  {
    name: "RETIRE/SOL",
    market: "crypto_spot",
    asset: "RETIRE/SOL",
    chain: "solana",
    pair_address: "6HfaJiUuTXFZEfmdkQSNbvfe6i95Nh2wUVJ5dWMf7gtw",
    token_address: "zGh48JtNHVBb5evgoZLXwgPD2Qu4MhkWdJLGDAupump",
    quote_address: "So11111111111111111111111111111111111111112",
    intervals,
    evaluation_intervals: ["1m", "15m", "1h"],
  },
  {
    name: "cbBTC/USDC Base",
    market: "crypto_spot",
    asset: "cbBTC/USDC",
    chain: "base",
    pair_address: "0x4e962BB3889Bf030368F56810A9c96B83CB3E778",
    token_address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    quote_address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    intervals,
    evaluation_intervals: ["1m", "15m"],
  },
  {
    name: "WETH/USDC Ethereum",
    market: "crypto_spot",
    asset: "WETH/USDC",
    chain: "ethereum",
    pair_address: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
    token_address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    quote_address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    intervals,
    evaluation_intervals: ["1m", "15m"],
  },
  {
    name: "RUNNER/WETH Robinhood Chain",
    market: "crypto_spot",
    asset: "RUNNER/WETH",
    chain: "robinhood",
    pair_address: "0x602633428507BBAA848E6D0c3127cda15eEAE6a9",
    token_address: "0x230442C8133A9efb4c278b3723043444749Ca08b",
    quote_address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
    intervals,
    evaluation_intervals: ["1m", "15m", "1h"],
    // This pool is only a few days old. Dense lower intervals remain the
    // readiness gate; higher intervals must preserve its real, bounded age
    // instead of manufacturing pre-launch history.
    minimum_bars: { "15m": 60, "1h": 20, "4h": 12, "1d": 2 },
  },
  {
    name: "SOL-PERP Hyperliquid",
    market: "perpetuals",
    asset: "SOL-PERP",
    intervals,
  },
  {
    name: "SPY Atlas",
    market: "equities",
    asset: "SPY",
    instrument_id: "etf:nyse-arca:spy",
    intervals: ["1m", "5m", "15m", "1h", "4h", "1d"],
    minimum_bars: { "15m": 100, "4h": 40 },
    requires_public_origin: true,
    expected_unavailable: true,
  },
];

const unavailableAnchors = [
  {
    name: "Unregistered network",
    market: "crypto_spot",
    asset: "UNKNOWN/USDC",
    chain: "unregistered-network",
    pair_address: "unverified-pool",
    token_address: "unverified-token",
    timeframe: "15m",
  },
];

function requestUrl(anchor, timeframe) {
  const params = new URLSearchParams({
    market: anchor.market,
    asset: anchor.asset,
    timeframe,
    limit: "480",
  });
  for (const field of ["chain", "pair_address", "token_address", "quote_address", "instrument_id"]) {
    if (anchor[field]) params.set(field, anchor[field]);
  }
  return `https://ravenos.local/api/terminal/chart?${params.toString()}`;
}

function validateCandles(payload, { minimum = 2 } = {}) {
  const rows = Array.isArray(payload?.candles) ? payload.candles : [];
  if (rows.length < minimum) throw new Error(`expected at least ${minimum} bars, received ${rows.length}`);
  const timestamps = rows.map((row) => Number(row.time));
  if (timestamps.some((value) => !Number.isFinite(value))) throw new Error("non-numeric candle timestamp");
  if (new Set(timestamps).size !== timestamps.length) throw new Error("duplicate normalized candle timestamp");
  for (let index = 1; index < timestamps.length; index += 1) {
    if (timestamps[index] <= timestamps[index - 1]) throw new Error("candles are not strictly ascending");
  }
  for (const row of rows) {
    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    if (![open, high, low, close].every((value) => Number.isFinite(value) && value > 0)) throw new Error("invalid OHLC value");
    if (high < Math.max(open, close) || low > Math.min(open, close)) throw new Error("inverted candle");
  }
  if (payload?.candle_series?.role !== "base_ohlcv") throw new Error("base candle-series contract missing");
  if (payload?.candle_series?.raven_observations_are_candles !== false) throw new Error("Raven candle substitution invariant missing");
  return rows;
}

async function requestPayload(anchor, timeframe) {
  const response = await ravenosWorker.fetch(new Request(requestUrl(anchor, timeframe)), env);
  const body = await response.json().catch(() => ({}));
  return { response, payload: body.data || body };
}

const results = [];
let failures = 0;

for (const anchor of anchors) {
  if (anchor.requires_public_origin && !publicOriginConfigured) {
    results.push({ anchor: anchor.name, state: "not_run", reason: "server-only public-origin binding not present in validator process" });
    if (productionMode) failures += 1;
    continue;
  }
  const anchorIntervals = fullMatrix ? anchor.intervals : (anchor.evaluation_intervals || anchor.intervals);
  for (const timeframe of anchorIntervals) {
    const started = Date.now();
    try {
      const { response, payload } = await requestPayload(anchor, timeframe);
      const selectedAliases = new Set([
        selectedProvider.toLowerCase(),
        selectedProvider.toLowerCase() === "coingecko" ? "coingecko_onchain" : "",
      ].filter(Boolean));
      const expectedUnavailable = anchor.expected_unavailable === true
        || (anchor.expected_unavailable_for || []).some((provider) => selectedAliases.has(provider));
      if (
        expectedUnavailable
        && !payload?.ok
        && (!Array.isArray(payload?.candles) || payload.candles.length === 0)
      ) {
        results.push({
          anchor: anchor.name,
          timeframe,
          state: "passed_unavailable",
          reason: payload?.message || payload?.source_type || `HTTP ${response.status}`,
          provider_state: payload?.provider_state || null,
          provider_attempts: Array.isArray(payload?.provider_attempts) ? payload.provider_attempts : null,
          latency_ms: Date.now() - started,
        });
        continue;
      }
      if (!response.ok || !payload?.ok) {
        const error = new Error(payload?.message || payload?.source_type || `HTTP ${response.status}`);
        error.provider_state = payload?.provider_state || null;
        error.provider_attempts = Array.isArray(payload?.provider_attempts) ? payload.provider_attempts : null;
        throw error;
      }
      const bars = validateCandles(payload, { minimum: anchor.minimum_bars?.[timeframe] || minimumBars[timeframe] || 2 });
      if (anchor.market === "crypto_spot" && payload.instrument?.pool_address?.toLowerCase() !== anchor.pair_address.toLowerCase()) throw new Error("exact pool identity mismatch");
      if (anchor.instrument_id && payload.instrument?.canonical_id !== anchor.instrument_id) throw new Error("exact listed identity mismatch");
      results.push({
        anchor: anchor.name,
        timeframe,
        state: "passed",
        bars: bars.length,
        source: payload.source,
        provider: payload.candle_series.provider,
        market_identity: payload.market_identity,
        freshness_state: payload.freshness_state,
        latency_ms: Date.now() - started,
      });
    } catch (error) {
      failures += 1;
      results.push({
        anchor: anchor.name,
        timeframe,
        state: "failed",
        reason: error instanceof Error ? error.message : "validation_failed",
        provider_state: error?.provider_state || null,
        provider_attempts: Array.isArray(error?.provider_attempts) ? error.provider_attempts : null,
        latency_ms: Date.now() - started,
      });
    }
    if (!providerKeyConfigured && anchor.market === "crypto_spot") await new Promise((resolve) => setTimeout(resolve, 2_500));
  }
}

for (const anchor of unavailableAnchors) {
  try {
    const { payload } = await requestPayload(anchor, anchor.timeframe);
    if (payload?.ok || (Array.isArray(payload?.candles) && payload.candles.length)) throw new Error("unsupported exact market returned candles");
    results.push({ anchor: anchor.name, timeframe: anchor.timeframe, state: "passed_unavailable", reason: payload?.message || payload?.source_type || "unavailable" });
  } catch (error) {
    failures += 1;
    results.push({ anchor: anchor.name, timeframe: anchor.timeframe, state: "failed", reason: error instanceof Error ? error.message : "validation_failed" });
  }
}

const report = {
  schema_version: "ravenos.chart_anchor_validation.v1",
  generated_at: new Date().toISOString(),
  production_mode: productionMode,
  full_matrix: fullMatrix,
  provider_key_configured: providerKeyConfigured,
  selected_provider: selectedProvider || null,
  provider_plan: providerPlan || null,
  provider_commercial: providerCommercial,
  keyless_diagnostic: allowKeylessDiagnostic,
  provider_order: effectiveProviderOrder,
  production_provider: productionProvider || null,
  production_provider_qualified: productionProviderQualified,
  public_origin_configured: publicOriginConfigured,
  passed: failures === 0,
  failures,
  results,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures) process.exitCode = 1;
