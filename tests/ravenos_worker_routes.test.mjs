import assert from "node:assert/strict";
import worker from "../worker.mjs";

const publicAssetPayloads = {
  "/ravenos_participant_heatmap.json": {
    generated_at: new Date().toISOString(),
    rows: [
      {
        chain: "solana",
        cap_band: "micro",
        sample_size: 42,
        confidence: "high",
        derived_state: "participation rewarding",
        plain_language_summary: "Micro-cap participation on Solana is producing stronger public outcomes than most rows.",
      },
      {
        chain: "base",
        cap_band: "small",
        sample_size: 18,
        confidence: "medium",
        derived_state: "outcomes unclear",
      },
    ],
  },
  "/ravenos_participant_outcomes.json": {
    generated_at: new Date().toISOString(),
    outcomes: [{ chain: "solana", cap_band: "micro", clean_sample: 42, participant_outcome: "favorable" }],
  },
  "/ravenos_historical_replay.json": { generated_at: new Date().toISOString(), comparables: [] },
  "/ravenos_recent_memory.json": { generated_at: new Date().toISOString(), memory: [] },
  "/public/data/ravenos_summary.json": { generated_at: new Date().toISOString(), public_read: "Current read forming." },
};
const assetResponse = new Response("asset", { status: 200 });
const env = {
  ASSETS: {
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      if (publicAssetPayloads[path]) {
        return new Response(JSON.stringify(publicAssetPayloads[path]), { status: 200, headers: { "content-type": "application/json" } });
      }
      return assetResponse;
    },
  },
  RAVENOS_MARKET_CAP_STAGE: "growth",
  RAVENOS_PRO_THRESHOLD_GROWTH: "500000",
  RAVENOS_FOUNDER_THRESHOLD: "10000000",
};

const noWallet = await worker.fetch(new Request("https://ravenos.xyz/api/access"), env);
assert.equal(noWallet.status, 200);
const noWalletPayload = await noWallet.json();
assert.equal(noWalletPayload.tier, "free");
assert.equal(noWalletPayload.status, "disconnected");
assert.equal(noWalletPayload.tokenAccessConfigured, false);
assert.equal(noWalletPayload.thresholds.pro, 500_000);

const wallet = await worker.fetch(new Request("https://ravenos.xyz/api/access?wallet=abc"), env);
assert.equal(wallet.status, 200);
const walletPayload = await wallet.json();
assert.equal(walletPayload.tier, "free");
assert.equal(walletPayload.wallet, "abc");
assert.equal(walletPayload.tokenAccessStatus, "not_configured");

const atlasEnv = {
  ...env,
  RAVENOS_DB: {
    prepare() {
      return {
        bind() {
          return {
            first: async () => ({
              status: "active",
              plan_type: "atlas_monthly",
              current_period_end: 1_800_000_000,
            }),
          };
        },
      };
    },
  },
};
const atlasWallet = await worker.fetch(new Request("https://ravenos.xyz/api/access?wallet=atlas-wallet"), atlasEnv);
assert.equal(atlasWallet.status, 200);
const atlasPayload = await atlasWallet.json();
assert.equal(atlasPayload.tier, "atlas");
assert.equal(atlasPayload.reason, "Atlas Subscription");
assert.equal(atlasPayload.subscription.plan_type, "atlas_monthly");

const dotPath = await worker.fetch(new Request("https://ravenos.xyz/.git/HEAD"), env);
assert.equal(dotPath.status, 404);

const staticAsset = await worker.fetch(new Request("https://ravenos.xyz/terminal/"), env);
assert.equal(staticAsset.status, 200);
assert.equal(await staticAsset.text(), "asset");

const publicStatus = await worker.fetch(new Request("https://ravenos.xyz/api/status"), env);
assert.equal(publicStatus.status, 200);
assert.match(publicStatus.headers.get("cache-control") || "", /max-age=30/);
const publicStatusPayload = await publicStatus.json();
assert.equal(publicStatusPayload.normal_pages_rebuild_required_for_data, false);
const opportunityStatus = publicStatusPayload.endpoints.find((row) => row.endpoint === "/api/opportunity");
assert.ok(opportunityStatus);
assert.equal(opportunityStatus.source, "dexscreener_public+bundled_artifact");
assert.equal(opportunityStatus.stale, false);
assert.ok(Number.isFinite(opportunityStatus.artifact_age_seconds));
assert.equal(opportunityStatus.leak_guard, "pass");
assert.equal(opportunityStatus.origin_fetch_failed, false);
assert.ok(Number.isFinite(opportunityStatus.last_known_good_age_seconds));

const publicOpportunity = await worker.fetch(new Request("https://ravenos.xyz/api/opportunity"), {
  ...env,
  RAVENOS_DISABLE_LIVE_PROVIDER_FETCH: "true",
});
assert.equal(publicOpportunity.status, 200);
assert.match(publicOpportunity.headers.get("cache-control") || "", /max-age=60/);
const publicOpportunityPayload = await publicOpportunity.json();
assert.equal(publicOpportunityPayload.safe_public, true);
assert.equal(publicOpportunityPayload.summary.best_surface.chain, "solana");

const publicArtifactOriginalFetch = globalThis.fetch;
let sawOriginBearer = false;
let sawOriginTokenHeader = false;
globalThis.fetch = async (url, init = {}) => {
  sawOriginBearer = String(init.headers?.authorization || "").startsWith("Bearer test-token");
  sawOriginTokenHeader = String(init.headers?.["x-ravenos-public-token"] || "") === "test-token";
  return new Response(JSON.stringify({
  ok: true,
  safe_public: true,
  generated_at: new Date().toISOString(),
  data: {
    generated_at: new Date().toISOString(),
    outcomes: [{ chain: "base", cap_band: "small", clean_sample: 88, confidence: "high", participant_outcome: "favorable" }],
  },
}), { status: 200, headers: { "content-type": "application/json" } });
};
const originOutcomes = await worker.fetch(new Request("https://ravenos.xyz/api/outcomes"), {
  ...env,
  RAVENOS_PUBLIC_ORIGIN_URL: "https://origin.example",
  RAVENOS_PUBLIC_ORIGIN_TOKEN: "test-token",
  RAVENOS_DISABLE_LIVE_PROVIDER_FETCH: "true",
});
const originOutcomesPayload = await originOutcomes.json();
assert.equal(originOutcomesPayload.source, "public_origin");
assert.equal(originOutcomesPayload.source_detail, "origin");
assert.equal(originOutcomesPayload.data.outcomes[0].chain, "base");
assert.equal(sawOriginBearer, true);
assert.equal(sawOriginTokenHeader, true);

const originStatus = await worker.fetch(new Request("https://ravenos.xyz/api/status"), {
  ...env,
  RAVENOS_PUBLIC_ORIGIN_URL: "https://origin.example",
  RAVENOS_PUBLIC_ORIGIN_TOKEN: "test-token",
  RAVENOS_DISABLE_LIVE_PROVIDER_FETCH: "true",
});
const originStatusPayload = await originStatus.json();
const originStatusOutcomes = originStatusPayload.endpoints.find((row) => row.endpoint === "/api/outcomes");
assert.equal(originStatusOutcomes.source, "public_origin");
assert.ok(["origin", "origin_cache"].includes(originStatusOutcomes.source_detail));
assert.equal(originStatusOutcomes.source_label, "public artifact origin");

globalThis.fetch = async () => new Response(JSON.stringify({
  generated_at: new Date().toISOString(),
  outcomes: [{ chain: "base", cap_band: "small", participant_outcome: "WalletMemory should not publish" }],
}), { status: 200, headers: { "content-type": "application/json" } });
const guardedOutcomes = await worker.fetch(new Request("https://ravenos.xyz/api/outcomes"), {
  ...env,
  RAVENOS_PUBLIC_ORIGIN_URL: "https://origin.example",
  RAVENOS_DISABLE_LIVE_PROVIDER_FETCH: "true",
});
const guardedOutcomesPayload = await guardedOutcomes.json();
assert.equal(guardedOutcomesPayload.source, "bundled_artifact");
assert.equal(guardedOutcomesPayload.data.outcomes[0].chain, "solana");
globalThis.fetch = publicArtifactOriginalFetch;

const publicOutcomes = await worker.fetch(new Request("https://ravenos.xyz/api/outcomes"), env);
assert.equal(publicOutcomes.status, 200);
assert.match(publicOutcomes.headers.get("cache-control") || "", /max-age=900/);
assert.equal((await publicOutcomes.json()).schema_version, "ravenos_outcomes_public_v1");

const missingAssetEnv = { ...env, ASSETS: { fetch: async () => new Response("missing", { status: 404 }) } };
const degradedBrief = await worker.fetch(new Request("https://ravenos.xyz/api/brief"), missingAssetEnv);
assert.equal(degradedBrief.status, 200);
const degradedBriefPayload = await degradedBrief.json();
assert.equal(degradedBriefPayload.status, "degraded");
assert.equal(degradedBriefPayload.safe_public, true);

function alertDb() {
  const alerts = [];
  const watchlists = [];
  const watchlistItems = [];
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            first: async () => {
              if (sql.includes("FROM subscriptions")) {
                return {
                  user_id: params[0],
                  wallet_public_key: params[0],
                  status: "active",
                  plan_type: "monthly",
                  current_period_end: 1_800_000_000,
                };
              }
              if (sql.includes("FROM alerts")) return alerts.find((row) => row.id === params[0] && row.user_id === params[1]) || null;
              if (sql.includes("COUNT(*)") && sql.includes("FROM watchlists")) return { count: watchlists.filter((row) => row.user_id === params[0]).length };
              if (sql.includes("COUNT(*)") && sql.includes("FROM watchlist_items")) return { count: watchlistItems.filter((row) => row.user_id === params[0] && row.watchlist_id === params[1]).length };
              if (sql.includes("FROM watchlists")) return watchlists.filter((row) => row.user_id === params[0])[0] || null;
              return null;
            },
            all: async () => {
              if (sql.includes("FROM alerts")) return { results: alerts.filter((row) => row.user_id === params[0]) };
              if (sql.includes("FROM alert_events")) return { results: [] };
              if (sql.includes("FROM watchlists")) return { results: watchlists.filter((row) => row.user_id === params[0]) };
              if (sql.includes("FROM watchlist_items")) return { results: watchlistItems.filter((row) => row.user_id === params[0] && row.watchlist_id === params[1]) };
              return { results: [] };
            },
            run: async () => {
              if (sql.includes("INSERT INTO alerts")) {
                alerts.push({
                  id: params[0],
                  user_id: params[1],
                  instrument: params[2],
                  market: params[3],
                  alert_type: params[4],
                  condition: params[5],
                  threshold: params[6],
                  enabled: params[7],
                  created_at: params[8],
                  updated_at: params[9],
                });
              } else if (sql.includes("UPDATE alerts SET")) {
                const row = alerts.find((item) => item.id === params[7] && item.user_id === params[8]);
                if (row) Object.assign(row, { enabled: params[5], updated_at: params[6] });
              } else if (sql.includes("DELETE FROM alerts")) {
                const idx = alerts.findIndex((row) => row.id === params[0] && row.user_id === params[1]);
                if (idx >= 0) alerts.splice(idx, 1);
              } else if (sql.includes("INSERT INTO watchlists")) {
                watchlists.push({ id: params[0], user_id: params[1], name: params[2], created_at: params[3], updated_at: params[4] });
              } else if (sql.includes("INSERT INTO watchlist_items")) {
                watchlistItems.push({
                  id: params[0],
                  watchlist_id: params[1],
                  user_id: params[2],
                  instrument: params[3],
                  market: params[4],
                  price: params[5],
                  flow_score: params[6],
                  pressure_score: params[7],
                  replay_similarity: params[8],
                  risk: params[9],
                  coverage: params[10],
                  provider: params[11],
                  source_payload: params[12],
                  created_at: params[13],
                  updated_at: params[14],
                });
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

const alertEnv = { ...env, RAVENOS_DB: alertDb() };
const alertsList = await worker.fetch(new Request("https://ravenos.xyz/api/alerts?wallet=pro-wallet"), alertEnv);
assert.equal(alertsList.status, 200);
assert.deepEqual((await alertsList.json()).alerts, []);

const createdAlert = await worker.fetch(new Request("https://ravenos.xyz/api/alerts", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    wallet: "pro-wallet",
    instrument: "SOL-PERP",
    market: "Perpetual Futures",
    alert_type: "pressure_score_crosses_threshold",
    condition: "crosses_above",
    threshold: 75,
  }),
}), alertEnv);
assert.equal(createdAlert.status, 201);
const createdAlertPayload = await createdAlert.json();
assert.equal(createdAlertPayload.alert.instrument, "SOL-PERP");
assert.equal(createdAlertPayload.access.tier, "pro");

const events = await worker.fetch(new Request("https://ravenos.xyz/api/alerts/events?wallet=pro-wallet"), alertEnv);
assert.equal(events.status, 200);
assert.deepEqual((await events.json()).events, []);

const unavailableAlert = await worker.fetch(new Request("https://ravenos.xyz/api/alerts", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    wallet: "pro-wallet",
    instrument: "SOL-PERP",
    market: "Perpetual Futures",
    alert_type: "pressure_score_crosses_threshold",
    threshold: 75,
  }),
}), env);
assert.equal(unavailableAlert.status, 503);
assert.equal((await unavailableAlert.json()).error, "alerts_db_unavailable");

const watchlistCreate = await worker.fetch(new Request("https://ravenos.xyz/api/watchlists", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ wallet: "pro-wallet", name: "Perps" }),
}), alertEnv);
assert.equal(watchlistCreate.status, 201);
const watchlistCreatePayload = await watchlistCreate.json();
assert.equal(watchlistCreatePayload.watchlist.name, "Perps");

const watchlistItem = await worker.fetch(new Request(`https://ravenos.xyz/api/watchlists/${watchlistCreatePayload.watchlist.id}/items`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ wallet: "pro-wallet", instrument: "SOL-PERP", market: "Perpetual Futures", flowScore: 84 }),
}), alertEnv);
assert.equal(watchlistItem.status, 201);
assert.equal((await watchlistItem.json()).item.instrument, "SOL-PERP");

const watchlistsList = await worker.fetch(new Request("https://ravenos.xyz/api/watchlists?wallet=pro-wallet"), alertEnv);
assert.equal(watchlistsList.status, 200);
assert.equal((await watchlistsList.json()).watchlists[0].items.length, 1);

const originalFetch = globalThis.fetch;
let sawCommaSeparatedCoinGeckoIds = false;
let forceCoingeckoDown = false;
let looseSearchCallsForKnownSymbols = 0;
globalThis.fetch = async (url, init) => {
  const href = String(url);
  if (href.includes("api.hyperliquid.xyz/info")) {
    return new Response(JSON.stringify([
      { universe: [{ name: "ETH" }] },
      [{ markPx: "1601.25", midPx: "1601.2", oraclePx: "1601.1", prevDayPx: "1580", funding: "0.00001", premium: "0.0002", openInterest: "100000", dayNtlVlm: "5000000" }],
    ]), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (href.includes("api.dexscreener.com/latest/dex/search")) {
    if (href.includes("AERO") || href.includes("WIF") || href.includes("MORPHO")) looseSearchCallsForKnownSymbols += 1;
    return new Response(JSON.stringify({
      pairs: [
        {
          chainId: "ethereum",
          dexId: "uniswap",
          pairAddress: "0xpair",
          baseToken: { symbol: "ETH", name: "Ether", address: "0xeth" },
          quoteToken: { symbol: "USDC" },
          priceUsd: "1658.42",
          liquidity: { usd: 1000000 },
          volume: { h24: 3000000 },
          txns: { h24: { buys: 100, sells: 80 } },
          priceChange: { h24: 1.2 },
        },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (href.includes("api.dexscreener.com/token-boosts/top/v1")) {
    return new Response(JSON.stringify([
      { chainId: "base", tokenAddress: "0xmicro000000000000000000000000000000000001" },
      { chainId: "solana", tokenAddress: "NanoMint11111111111111111111111111111111111" },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (href.includes("api.dexscreener.com/token-profiles/latest/v1")) {
    return new Response(JSON.stringify([
      { chainId: "ethereum", tokenAddress: "0xlarge000000000000000000000000000000000001" },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (href.includes("api.dexscreener.com/token-pairs/v1/base/0xmicro000000000000000000000000000000000001")) {
    return new Response(JSON.stringify([
      {
        chainId: "base",
        dexId: "uniswap",
        pairAddress: "microbasepair",
        baseToken: { symbol: "MICRO", name: "Micro Base", address: "0xmicro000000000000000000000000000000000001" },
        quoteToken: { symbol: "USDC" },
        priceUsd: "0.00042",
        liquidity: { usd: 25000 },
        volume: { h24: 120000 },
        txns: { h24: { buys: 300, sells: 220 } },
        marketCap: 520000,
        fdv: 520000,
      },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (href.includes("api.dexscreener.com/token-pairs/v1/solana/NanoMint11111111111111111111111111111111111")) {
    return new Response(JSON.stringify([
      {
        chainId: "solana",
        dexId: "raydium",
        pairAddress: "nanopair",
        baseToken: { symbol: "NANO", name: "Nano Solana", address: "NanoMint11111111111111111111111111111111111" },
        quoteToken: { symbol: "SOL" },
        priceUsd: "0.000001",
        liquidity: { usd: 8000 },
        volume: { h24: 9000 },
        txns: { h24: { buys: 40, sells: 35 } },
        marketCap: 42000,
        fdv: 42000,
      },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (href.includes("api.dexscreener.com/token-pairs/v1/ethereum/0xlarge000000000000000000000000000000000001")) {
    return new Response(JSON.stringify([
      {
        chainId: "ethereum",
        dexId: "uniswap",
        pairAddress: "largepair",
        baseToken: { symbol: "LARGE", name: "Large Ethereum", address: "0xlarge000000000000000000000000000000000001" },
        quoteToken: { symbol: "USDC" },
        priceUsd: "1.23",
        liquidity: { usd: 1200000 },
        volume: { h24: 320000 },
        txns: { h24: { buys: 110, sells: 90 } },
        marketCap: 220000000,
        fdv: 220000000,
      },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (href.includes("api.dexscreener.com/token-pairs/v1/ethereum/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2")) {
    return new Response(JSON.stringify([
      {
        chainId: "ethereum",
        dexId: "uniswap",
        pairAddress: "0xethpair",
        baseToken: { symbol: "WETH", name: "Wrapped Ether", address: "0xeth" },
        quoteToken: { symbol: "USDC" },
        priceUsd: "1658.42",
        liquidity: { usd: 1000000 },
        volume: { h24: 3000000 },
        txns: { h24: { buys: 100, sells: 80 } },
      },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (href.includes("api.dexscreener.com/token-pairs/v1/solana/So11111111111111111111111111111111111111112")) {
    return new Response(JSON.stringify([
      {
        chainId: "solana",
        dexId: "orca",
        pairAddress: "solpair",
        baseToken: { symbol: "SOL", name: "Solana", address: "So11111111111111111111111111111111111111112" },
        quoteToken: { symbol: "USDC" },
        priceUsd: "68.76",
        liquidity: { usd: 23000000 },
        volume: { h24: 9000000 },
        txns: { h24: { buys: 100, sells: 80 } },
      },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (href.includes("api.dexscreener.com/token-pairs/v1/base/0x940181a94A35A4569E4529A3CDfB74e38FD98631")) {
    return new Response(JSON.stringify([
      {
        chainId: "base",
        dexId: "aerodrome",
        pairAddress: "aeropair",
        baseToken: { symbol: "AERO", name: "Aerodrome", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631" },
        quoteToken: { symbol: "USDC" },
        priceUsd: "0.5022",
        liquidity: { usd: 25000000 },
        volume: { h24: 2000000 },
        txns: { h24: { buys: 100, sells: 80 } },
      },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (href.includes("api.dexscreener.com/token-pairs/v1/solana/EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm")) {
    return new Response(JSON.stringify([
      {
        chainId: "solana",
        dexId: "raydium",
        pairAddress: "wifpair",
        baseToken: { symbol: "$WIF", name: "dogwifhat", address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
        quoteToken: { symbol: "SOL" },
        priceUsd: "0.1561",
        liquidity: { usd: 4000000 },
        volume: { h24: 450000 },
        txns: { h24: { buys: 100, sells: 80 } },
      },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (href.includes("api.dexscreener.com/token-pairs/v1/ethereum/0x58D97B57BB95320F9a05dC918Aef65434969c2B2")) {
    return new Response(JSON.stringify([
      {
        chainId: "ethereum",
        dexId: "uniswap",
        pairAddress: "morphopair",
        baseToken: { symbol: "MORPHO", name: "Morpho", address: "0x58D97B57BB95320F9a05dC918Aef65434969c2B2" },
        quoteToken: { symbol: "ETH" },
        priceUsd: "1.64",
        liquidity: { usd: 500000 },
        volume: { h24: 500000 },
        txns: { h24: { buys: 100, sells: 80 } },
      },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (href.includes("api.dexscreener.com/token-pairs/v1/base/0x4f9fd6be4a90f2620860d680c0d4d5fb53d1a825")) {
    return new Response(JSON.stringify([
      {
        chainId: "base",
        dexId: "uniswap",
        pairAddress: "aixbtpair",
        baseToken: { symbol: "AIXBT", name: "aixbt", address: "0x4f9fd6be4a90f2620860d680c0d4d5fb53d1a825" },
        quoteToken: { symbol: "VIRTUAL" },
        priceUsd: "0.02189",
        liquidity: { usd: 800000 },
        volume: { h24: 500000 },
        txns: { h24: { buys: 100, sells: 80 } },
      },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (href.includes("api.coingecko.com/api/v3/simple/price")) {
    if (forceCoingeckoDown) return new Response(JSON.stringify({ error: "down" }), { status: 503, headers: { "content-type": "application/json" } });
    if (href.includes("ids=") && href.includes(",") && !href.includes("%2C")) sawCommaSeparatedCoinGeckoIds = true;
    return new Response(JSON.stringify({
      ethereum: { usd: 1658.42 },
      solana: { usd: 68.76 },
      bitcoin: { usd: 62123.45 },
      chainlink: { usd: 7.57 },
      "jupiter-exchange-solana": { usd: 0.201 },
      "degen-base": { usd: 0.00188 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return originalFetch(url, init);
};

const spotPrices = await worker.fetch(new Request("https://ravenos.xyz/api/market/prices?market=spot&symbols=ETH"), env);
assert.equal(spotPrices.status, 200);
const spotPricePayload = await spotPrices.json();
assert.equal(spotPricePayload.results[0].symbol, "ETH");
assert.equal(spotPricePayload.results[0].priceUsd, 1658.42);
assert.equal(spotPricePayload.results[0].provider, "CoinGecko");
assert.equal(spotPricePayload.results[0].coverage, "Developing");

const solSpotPrices = await worker.fetch(new Request("https://ravenos.xyz/api/market/prices?market=spot&symbols=SOL"), env);
assert.equal(solSpotPrices.status, 200);
const solSpotPricePayload = await solSpotPrices.json();
assert.equal(solSpotPricePayload.results[0].symbol, "SOL");
assert.equal(solSpotPricePayload.results[0].priceUsd, 68.76);
assert.equal(solSpotPricePayload.results[0].provider, "CoinGecko");
assert.equal(solSpotPricePayload.results[0].coverage, "Developing");

const batchSpotPrices = await worker.fetch(new Request("https://ravenos.xyz/api/market/prices?market=spot&symbols=BTC,ETH,SOL,LINK,JUP,DEGEN"), env);
assert.equal(batchSpotPrices.status, 200);
const batchSpotPricePayload = await batchSpotPrices.json();
const batchBySymbol = new Map(batchSpotPricePayload.results.map((row) => [row.symbol, row]));
assert.equal(batchBySymbol.get("BTC").priceUsd, 62123.45);
assert.equal(batchBySymbol.get("LINK").priceUsd, 7.57);
assert.equal(batchBySymbol.get("JUP").priceUsd, 0.201);
assert.equal(batchBySymbol.get("DEGEN").priceUsd, 0.00188);
assert.equal(sawCommaSeparatedCoinGeckoIds, true);

const perpPrices = await worker.fetch(new Request("https://ravenos.xyz/api/market/prices?market=perp&symbols=ETH"), env);
assert.equal(perpPrices.status, 200);
const perpPricePayload = await perpPrices.json();
assert.equal(perpPricePayload.results[0].symbol, "ETH");
assert.equal(perpPricePayload.results[0].priceUsd, 1601.25);
assert.equal(perpPricePayload.results[0].provider, "Hyperliquid");

forceCoingeckoDown = true;
const canonicalFallbackPrices = await worker.fetch(new Request("https://ravenos.xyz/api/market/prices?market=spot&symbols=AERO,WIF,MORPHO,AIXBT"), env);
assert.equal(canonicalFallbackPrices.status, 200);
const canonicalFallbackPayload = await canonicalFallbackPrices.json();
const canonicalFallbackBySymbol = new Map(canonicalFallbackPayload.results.map((row) => [row.symbol, row]));
assert.equal(canonicalFallbackBySymbol.get("AERO").priceUsd, 0.5022);
assert.equal(canonicalFallbackBySymbol.get("AERO").provider, "Dexscreener");
assert.equal(canonicalFallbackBySymbol.get("WIF").priceUsd, 0.1561);
assert.equal(canonicalFallbackBySymbol.get("MORPHO").priceUsd, 1.64);
assert.equal(canonicalFallbackBySymbol.get("AIXBT").priceUsd, 0.02189);
assert.equal(looseSearchCallsForKnownSymbols, 0);

const trendingMicro = await worker.fetch(new Request("https://ravenos.xyz/api/dexscreener/trending?category=micro_caps&limit=50"), env);
assert.equal(trendingMicro.status, 200);
const trendingMicroPayload = await trendingMicro.json();
assert.equal(trendingMicroPayload.results[0].symbol, "MICRO");
assert.equal(trendingMicroPayload.results[0].chainId, "base");
assert.equal(trendingMicroPayload.results[0].marketCap, 520000);

globalThis.fetch = originalFetch;
