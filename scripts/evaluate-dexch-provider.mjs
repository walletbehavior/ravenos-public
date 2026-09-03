import { DexchDiscoveryProvider } from "../lib/dexch_discovery_provider.mjs";

const CHAINS = Object.freeze(["solana", "robinhood", "bsc"]);
const SAMPLE_LIMIT = 25;
const DETAIL_SAMPLE = 2;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values = []) {
  const rows = values.map(finite).filter((value) => value !== null).sort((left, right) => left - right);
  if (!rows.length) return null;
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
}

function relativeDifference(left, right) {
  const first = finite(left);
  const second = finite(right);
  if (first === null || second === null || first < 0 || second < 0 || Math.max(first, second) === 0) return null;
  return Math.abs(first - second) / Math.max(first, second) * 100;
}

function sameAddress(chain, left, right) {
  return chain === "solana"
    ? String(left || "") === String(right || "")
    : String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

async function boundedJson(url, { timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) throw new Error("payload_too_large");
    return { payload: JSON.parse(body), latency_ms: Math.round((performance.now() - started) * 10) / 10 };
  } finally {
    clearTimeout(timeout);
  }
}

function bestDexScreenerPair(chain, token, pairs = []) {
  return pairs
    .filter((pair) => String(pair?.chainId || "").toLowerCase() === chain)
    .filter((pair) => sameAddress(chain, pair?.baseToken?.address, token.address))
    .sort((left, right) => Number(right?.liquidity?.usd || 0) - Number(left?.liquidity?.usd || 0))[0] || null;
}

async function evaluateChain(chain) {
  const provider = new DexchDiscoveryProvider();
  const started = performance.now();
  const envelope = await provider.tokens({ chains: [chain], sort: "trending", limit: SAMPLE_LIMIT });
  const discoveryLatency = Math.round((performance.now() - started) * 10) / 10;
  const tokens = envelope.rows;
  const addresses = tokens.map((token) => token.address).join(",");
  let comparison = { payload: [], latency_ms: null };
  let comparisonError = null;
  if (addresses) {
    try {
      comparison = await boundedJson(`https://api.dexscreener.com/tokens/v1/${encodeURIComponent(chain)}/${encodeURIComponent(addresses)}`);
    } catch (error) {
      comparisonError = String(error?.message || "unavailable");
    }
  }
  const pairs = Array.isArray(comparison.payload) ? comparison.payload : [];
  const priceDifferences = [];
  const liquidityDifferences = [];
  let comparable = 0;
  for (const token of tokens) {
    const pair = bestDexScreenerPair(chain, token, pairs);
    if (!pair) continue;
    comparable += 1;
    const priceDifference = relativeDifference(token.market.price_usd, pair.priceUsd);
    const liquidityDifference = relativeDifference(token.market.liquidity_usd, pair.liquidity?.usd);
    if (priceDifference !== null) priceDifferences.push(priceDifference);
    if (liquidityDifference !== null) liquidityDifferences.push(liquidityDifference);
  }
  const detailChecks = [];
  for (const token of tokens.slice(0, DETAIL_SAMPLE)) {
    const detailStarted = performance.now();
    const result = { detail: "unavailable", holders: "unavailable", candles: "unavailable", latency_ms: null };
    try {
      const detail = await provider.token(chain, token.address);
      result.detail = detail.row_count === 1 ? "available" : "empty";
      result.latency_ms = Math.round((performance.now() - detailStarted) * 10) / 10;
    } catch (error) {
      result.detail = String(error?.message || "unavailable");
    }
    try {
      const holders = await provider.holders(chain, token.address, { limit: 20 });
      result.holders = holders.rows.length ? `provider_top_${holders.rows.length}` : holders.quality.state;
    } catch (error) {
      result.holders = String(error?.message || "unavailable");
    }
    try {
      const candles = await provider.candles(chain, token.address, { timeframe: "5m", limit: 60 });
      result.candles = candles.rows.length ? `${candles.rows.length}_bars` : "empty";
    } catch (error) {
      result.candles = String(error?.message || "unavailable");
    }
    detailChecks.push(result);
  }
  const fields = [
    ["price", (token) => token.market.price_usd],
    ["market_cap", (token) => token.market.market_cap_usd],
    ["liquidity", (token) => token.market.liquidity_usd],
    ["volume_24h", (token) => token.market.volume_24h_usd],
    ["holders", (token) => token.market.holder_count],
    ["created_at", (token) => token.lifecycle.created_at],
    ["bonding_progress", (token) => token.lifecycle.progress_bps],
  ];
  return {
    chain,
    sample_rows: tokens.length,
    dexch_discovery_latency_ms: discoveryLatency,
    response_bytes: envelope.provenance.response_bytes,
    exact_identity_duplicates: tokens.length - new Set(tokens.map((token) => token.canonical_identity.asset_id)).size,
    quality: {
      contradictory_rows: tokens.filter((token) => token.quality.state === "contradictory").length,
      partial_rows: tokens.filter((token) => token.quality.state === "partial").length,
      field_coverage_pct: Object.fromEntries(fields.map(([name, read]) => [
        name,
        tokens.length ? Math.round(tokens.filter((token) => read(token) !== null && read(token) !== undefined).length / tokens.length * 1_000) / 10 : 0,
      ])),
      lifecycle_states: Object.fromEntries([...new Set(tokens.map((token) => token.lifecycle.state))]
        .sort()
        .map((state) => [state, tokens.filter((token) => token.lifecycle.state === state).length])),
    },
    cross_provider_snapshot: {
      provider: "dexscreener",
      latency_ms: comparison.latency_ms,
      error: comparisonError,
      comparable_tokens: comparable,
      median_price_difference_pct: median(priceDifferences),
      median_liquidity_difference_pct: median(liquidityDifferences),
      interpretation: "Different pool selection, aggregation windows, and timestamps may explain unresolved differences.",
    },
    detail_checks: detailChecks,
    provider_health: provider.healthSnapshot(),
  };
}

const startedAt = new Date().toISOString();
const results = [];
for (const chain of CHAINS) {
  try {
    results.push(await evaluateChain(chain));
  } catch (error) {
    results.push({ chain, error: String(error?.message || "unavailable") });
  }
}

console.log(JSON.stringify({
  schema_version: "ravenos.dexch_empirical_evaluation.v1",
  started_at: startedAt,
  completed_at: new Date().toISOString(),
  sample_limit_per_chain: SAMPLE_LIMIT,
  raw_token_addresses_emitted: false,
  execution_authority: false,
  results,
}, null, 2));
