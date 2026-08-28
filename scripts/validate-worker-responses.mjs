import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import bs58 from "bs58";

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

const env = {
  ASSETS: assets,
  ONCHAIN_CHART_PROVIDER: "coingecko",
  ONCHAIN_CHART_PROVIDER_PLAN: "demo",
  ONCHAIN_CHART_PROVIDER_COMMERCIAL: "false",
  ONCHAIN_CHART_PROVIDER_SECRET: "worker-response-provider-validation-token",
  RAVENOS_PUBLIC_ORIGIN_URL: "https://validation-origin.example/public/ravenos",
  RAVENOS_PUBLIC_ORIGIN_TOKEN: "worker-response-validation-token",
  RAVENOS_SPOT_CHART_ORIGIN_URL: "https://validation-origin.example/public/ravenos/chart.json",
  RAVENOS_SPOT_CHART_ORIGIN_TOKEN: "worker-response-validation-token",
  RAVENOS_PUBLIC_SOLANA_HOLDERS_ENABLED: "1",
  RAVENOS_PUBLIC_SOLANA_HOLDERS_RPC_URL: "https://validation-solana-rpc.example/rpc",
};
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
  ["GET", "/api/atlas"],
  ["GET", "/api/instruments/search?q=AAPL"],
  ["GET", "/api/onchain/trending?chains=base,ethereum,robinhood&duration=5m"],
  ["GET", "/api/onchain/token-metadata?chain=solana&addresses=4Nd1mYtH6cQqVaM4D6j6fLQ1xUeLLkL3ZnH8JY5FQ7pP"],
  ["GET", "/api/onchain/holders?chain=solana&pair_address=3w7NMJECsezNurAb3MbvTiEtVeayhqNXgXXcqiK5qwwj&token_address=EBLUKPgx5FvTUBU6bTJi3aR8XVELSBdC5FiodSWQpump&quote_address=So11111111111111111111111111111111111111112"],
  ["GET", "/api/onchain/trades?chain=base&pair_address=0x1111111111111111111111111111111111111111&token_address=0x2222222222222222222222222222222222222222&quote_address=0x3333333333333333333333333333333333333333"],
  ["GET", "/api/terminal/chart?market=equities&asset=AAPL&timeframe=1h&instrument_id=equity%3Anasdaq%3Aaapl"],
  ["GET", "/api/terminal/chart?market=crypto_spot&asset=TEST%2FUSDC&timeframe=15m&chain=base&pair_address=0x1111111111111111111111111111111111111111&token_address=0x2222222222222222222222222222222222222222"],
  ["GET", "/api/terminal"],
  ["GET", "/api/chains/solana"],
  ["GET", "/api/chains/base"],
  ["GET", "/api/chains/ethereum"],
  ["GET", "/api/trade/flags"],
  ["POST", "/api/trade/market-preview", {
    instrument_id: "hyperliquid:perp:SOL",
    side: "long",
    notional_usdc: 500,
    leverage: 3,
    max_impact_bps: 100,
  }],
  ["POST", "/api/trade/order-plan", {
    instrument_id: "hyperliquid:perp:SOL",
    side: "long",
    order_type: "market",
    notional_usdc: 500,
    leverage: 3,
    max_impact_bps: 100,
  }],
  ["POST", "/api/trade/account-snapshot", {
    address: "0x000000000000000000000000000000000000dead",
  }],
  ["POST", "/api/trade/account-scenario", {
    address: "0x000000000000000000000000000000000000dead",
    instrument_id: "hyperliquid:perp:SOL",
    side: "long",
    order_type: "market",
    notional_usdc: 500,
    leverage: 3,
    margin_mode: "cross",
    reduce_only: false,
    max_impact_bps: 100,
  }],
  ["POST", "/api/trade/account-history", {
    address: "0x000000000000000000000000000000000000dead",
    kind: "orders",
  }],
  ["GET", "/api/access"],
  ["GET", "/api/not-a-route"],
  ["POST", "/api/trade/quote", {}],
  ["POST", "/api/trade/inspect", {}],
  ["POST", "/api/stripe/checkout", {}],
];

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  if (url === "https://validation-solana-rpc.example/rpc") {
    const rpc = JSON.parse(init.body || "{}");
    if (rpc.method === "getAccountInfo") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { context: { slot: 42 }, value: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: ["", "base64"] } } }), { status: 200, headers: { "content-type": "application/json" } });
    if (rpc.method === "getProgramAccounts") {
      const bytes = Buffer.alloc(72);
      Buffer.from(bs58.decode("EBLUKPgx5FvTUBU6bTJi3aR8XVELSBdC5FiodSWQpump")).copy(bytes, 0);
      Buffer.from(bs58.decode("Stake11111111111111111111111111111111111111")).copy(bytes, 32);
      bytes.writeBigUInt64LE(125000000n, 64);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { context: { slot: 43 }, value: [{ pubkey: "SysvarRent111111111111111111111111111111111", account: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: [bytes.toString("base64"), "base64"] } }] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (rpc.method === "getTokenLargestAccounts") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { context: { slot: 42 }, value: [{ address: "SysvarRent111111111111111111111111111111111", amount: "125000000", decimals: 6, uiAmountString: "125" }] } }), { status: 200, headers: { "content-type": "application/json" } });
    if (rpc.method === "getTokenSupply") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { context: { slot: 42 }, value: { amount: "1000000000", decimals: 6, uiAmountString: "1000" } } }), { status: 200, headers: { "content-type": "application/json" } });
    if (rpc.method === "getMultipleAccounts") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { context: { slot: 43 }, value: [{ data: { program: "spl-token", parsed: { info: { mint: "EBLUKPgx5FvTUBU6bTJi3aR8XVELSBdC5FiodSWQpump", owner: "Stake11111111111111111111111111111111111111", tokenAmount: { amount: "125000000", decimals: 6, uiAmountString: "125" } }, type: "account" }, space: 165 } }] } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("validation-origin.example/public/ravenos/chart.json")) {
    const now = Math.floor(Date.now() / 900_000) * 900;
    return new Response(JSON.stringify({
      schema_version: "ravenos.spot_chart_projection.v1",
      ok: true,
      chain: "base",
      instrument_scope: "exact_pool",
      pair_address: "0x1111111111111111111111111111111111111111",
      token_address: "0x2222222222222222222222222222222222222222",
      quote_address: "0x3333333333333333333333333333333333333333",
      price_unit: "quote_per_token",
      source: "Raven EVM exact swap",
      freshness_state: "live",
      observed_at: new Date(now * 1_000).toISOString(),
      available_scopes: { exact_pool: true, token_aggregate: false },
      lineage: {
        identity_scope: "exact_pool",
        latest_source_event_id: "private:event:123",
        latest_source_name: "private-source.json",
        source_registry_paths: ["/srv/raven/app/data/runtime/private-registry.json"],
      },
      recent_trades: [{ id: "raven-event", time: now - 900, price: 1, size: 1, side: "buy" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("api.dexpaprika.com") && url.includes("/ohlcv?")) {
    const now = Math.floor(Date.now() / 900_000) * 900;
    const rows = Array.from({ length: 120 }, (_, index) => ({
      time_open: new Date((now - (119 - index) * 900) * 1_000).toISOString(),
      open: 1,
      high: 1.1,
      low: 0.9,
      close: 1.05,
      volume: 10,
    }));
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("api.dexpaprika.com/networks/base/pools/0x1111111111111111111111111111111111111111")) {
    return new Response(JSON.stringify({
      id: "0x1111111111111111111111111111111111111111",
      chain: "base",
      dex_id: "validation_pool",
      created_at: "2024-01-01T00:00:00Z",
      base_token_id: "0x2222222222222222222222222222222222222222",
      quote_token_id: "0x3333333333333333333333333333333333333333",
      liquidity_usd: 100_000,
      tokens: [
        { id: "0x2222222222222222222222222222222222222222", symbol: "TEST" },
        { id: "0x3333333333333333333333333333333333333333", symbol: "USDC" },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("api.coingecko.com/api/v3/onchain")) {
    if (init.headers?.["x-cg-demo-api-key"] !== env.ONCHAIN_CHART_PROVIDER_SECRET) throw new Error("server-only provider credential was not bound to the provider request");
    if (url.includes(env.ONCHAIN_CHART_PROVIDER_SECRET)) throw new Error("provider credential entered the request URL");
    if (url.includes("/trending_pools")) {
      const network = url.includes("/networks/eth/") ? "eth" : "base";
      const pool = network === "eth"
        ? "0x4444444444444444444444444444444444444444"
        : "0x1111111111111111111111111111111111111111";
      const token = network === "eth"
        ? "0x5555555555555555555555555555555555555555"
        : "0x2222222222222222222222222222222222222222";
      const quote = network === "eth"
        ? "0x6666666666666666666666666666666666666666"
        : "0x3333333333333333333333333333333333333333";
      return new Response(JSON.stringify({
        data: [{
          id: `${network}_${pool}`,
          type: "pool",
          attributes: {
            address: pool,
            name: "VALID / USDC",
            pool_created_at: "2026-01-01T00:00:00Z",
            base_token_price_usd: "1.25",
            quote_token_price_usd: "1",
            fdv_usd: "125000000",
            market_cap_usd: "84000000",
            reserve_in_usd: "920000",
            price_change_percentage: { m5: "4.2", h1: "8.4", h24: "14.8" },
            volume_usd: { m5: "42000", h1: "280000", h24: "2100000" },
            transactions: {
              m5: { buys: 48, sells: 20, buyers: 36, sellers: 18 },
              h1: { buys: 210, sells: 122, buyers: 140, sellers: 90 },
              h24: { buys: 1200, sells: 880, buyers: 620, sellers: 490 },
            },
          },
          relationships: {
            base_token: { data: { id: `${network}_${token}`, type: "token" } },
            quote_token: { data: { id: `${network}_${quote}`, type: "token" } },
            dex: { data: { id: `${network}-dex`, type: "dex" } },
          },
        }],
        included: [{
          id: `${network}_${token}`,
          type: "token",
          attributes: {
            address: token,
            symbol: "VALID",
            name: "Validation Token",
            decimals: 18,
            image_url: "https://coin-images.coingecko.com/coins/images/1/large/test.png",
          },
        }, {
          id: `${network}_${quote}`,
          type: "token",
          attributes: { address: quote, symbol: "USDC", name: "USD Coin", decimals: 6 },
        }, {
          id: `${network}-dex`,
          type: "dex",
          attributes: { name: "Validation DEX" },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/trades")) {
      return new Response(JSON.stringify({
        data: [{
          id: "base_123_0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_1_1787904000",
          type: "trade",
          attributes: {
            block_number: 123,
            tx_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            tx_from_address: "0x4444444444444444444444444444444444444444",
            from_token_amount: "25",
            to_token_amount: "20",
            price_from_in_usd: "1",
            price_to_in_usd: "1.25",
            block_timestamp: new Date(Date.now() - 30_000).toISOString(),
            kind: "buy",
            volume_in_usd: "25",
            from_token_address: "0x3333333333333333333333333333333333333333",
            to_token_address: "0x2222222222222222222222222222222222222222"
          }
        }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (!url.includes("/ohlcv/")) {
      return new Response(JSON.stringify({
        data: {
          id: "base_0x1111111111111111111111111111111111111111",
          type: "pool",
          attributes: { address: "0x1111111111111111111111111111111111111111" },
          relationships: {
            base_token: { data: { id: "base_0x2222222222222222222222222222222222222222" } },
            quote_token: { data: { id: "base_0x3333333333333333333333333333333333333333" } },
          },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const now = Math.floor(Date.now() / 900_000) * 900;
    const rows = Array.from({ length: 120 }, (_, index) => [now - (119 - index) * 900, 1, 1.1, 0.9, 1.05, 10]);
    return new Response(JSON.stringify({ data: { attributes: { ohlcv_list: rows } } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("api.dexscreener.com")) {
    if (url.includes("/latest/dex/pairs/solana/3w7NMJECsezNurAb3MbvTiEtVeayhqNXgXXcqiK5qwwj")) {
      return new Response(JSON.stringify({ pairs: [{
        chainId: "solana",
        dexId: "pumpswap",
        pairAddress: "3w7NMJECsezNurAb3MbvTiEtVeayhqNXgXXcqiK5qwwj",
        baseToken: { address: "EBLUKPgx5FvTUBU6bTJi3aR8XVELSBdC5FiodSWQpump", name: "bitcat", symbol: "BITCAT" },
        quoteToken: { address: "So11111111111111111111111111111111111111112", name: "Wrapped SOL", symbol: "SOL" },
        liquidity: { usd: 64_000 },
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/tokens/v1/")) {
      return new Response(JSON.stringify([{
        chainId: "solana",
        dexId: "validation_pool",
        pairAddress: "7nZP2q2w6Kc3yYF4tQ8rR1vV5bD9mA2pE6uH3xJ8sL4N",
        baseToken: {
          address: "4Nd1mYtH6cQqVaM4D6j6fLQ1xUeLLkL3ZnH8JY5FQ7pP",
          name: "Validation Token",
          symbol: "VALID",
        },
        quoteToken: {
          address: "So11111111111111111111111111111111111111112",
          name: "Wrapped SOL",
          symbol: "SOL",
        },
        liquidity: { usd: 82_000 },
        info: {
          imageUrl: "https://cdn.dexscreener.com/cms/images/validation-token?width=200",
          websites: [{ url: "https://must-not-reach-public-response.example" }],
          socials: [{ type: "twitter", url: "https://must-not-reach-public-response.example/social" }],
        },
        provider_payload: { credential: "must-be-stripped" },
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ pairs: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/instrument_chart.json?q=AAPL&instrument_id=equity%3Anasdaq%3Aaapl&timeframe=1h&limit=360")) {
    const lastTime = Math.floor(Date.now() / 1_000) - 60;
    return new Response(JSON.stringify({
      ok: true,
      safe_public: true,
      redaction_policy: "aggregate_public_market_context_only",
      schema_version: "ravenos.instrument_chart.v1",
      generated_at: new Date().toISOString(),
      freshness_target_seconds: 300,
      query: "AAPL",
      instrument_id: "equity:nasdaq:aapl",
      timeframe: "1h",
      provider: "Yahoo Finance",
      identity_provider: "Tradier",
      instrument: {
        schema_version: "ravenos.instrument.v1",
        instrument_id: "equity:nasdaq:aapl",
        symbol: "AAPL",
        display_name: "Apple Inc.",
        asset_class: "equity",
        instrument_type: "equity",
        identity_scope: "exact_instrument",
        venue: "nasdaq",
        chain: "none",
        market_identity: { market_id: "AAPL", listing: "Nasdaq" },
        quote_asset: { symbol: "USD", asset_id: "USD" },
        settlement_asset: { symbol: "USD", asset_id: "USD" },
        capabilities: { chart: true, live_price: true, quote_preview: false, execution: false },
      },
      candles: [
        { time: lastTime - 3600, open: 210, high: 212, low: 209, close: 211, volume: 100 },
        { time: lastTime, open: 211, high: 213, low: 210, close: 212, volume: 120 },
      ],
      market_data_observed_at: new Date(lastTime * 1_000).toISOString(),
      provider_debug: { credential: "must-be-stripped" },
      execution_boundary: { broker_connection_available: false, quote_preview_available: false, signing_available: false, submission_available: false, position_monitoring_available: false },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/instrument_lookup.json?q=AAPL")) {
    return new Response(JSON.stringify({
      ok: true,
      safe_public: true,
      redaction_policy: "aggregate_public_market_context_only",
      schema_version: "ravenos.instrument_lookup.v1",
      generated_at: new Date().toISOString(),
      freshness_target_seconds: 300,
      query: "AAPL",
      provider: "Tradier",
      provider_debug: { credential: "must-be-stripped" },
      results: [{
        schema_version: "ravenos.instrument.v1",
        instrument_id: "equity:nasdaq:aapl",
        symbol: "AAPL",
        display_name: "Apple Inc.",
        asset_class: "equity",
        instrument_type: "equity",
        identity_scope: "exact_instrument",
        venue: "nasdaq",
        chain: "none",
        market_identity: { market_id: "AAPL", listing: "Nasdaq" },
        quote_asset: { symbol: "USD", asset_id: "USD" },
        settlement_asset: { symbol: "USD", asset_id: "USD" },
        capabilities: { chart: true, live_price: true, quote_preview: false, execution: false },
        provider_payload: { credential: "must-be-stripped" },
      }],
      execution_boundary: { broker_connection_available: false, quote_preview_available: false, signing_available: false, submission_available: false },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ ok: false }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
};

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
    if (text.includes(env.ONCHAIN_CHART_PROVIDER_SECRET)) findings.push({ file: label, path: "", term: "provider_secret_value" });
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
