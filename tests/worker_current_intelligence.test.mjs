import assert from "node:assert/strict";
import test from "node:test";

import { buildDiscoverRadarProjection } from "../lib/discover_radar.mjs";
import worker from "../worker.mjs";

const ORIGIN = "https://origin.example/public/ravenos";
const NOW = Date.now();

function isoAgo(seconds) {
  return new Date(NOW - seconds * 1000).toISOString();
}

function projection(key, schema, data = {}, generatedAt = isoAgo(10), freshnessTargetSeconds = 900) {
  return {
    ok: true,
    safe_public: true,
    key,
    schema_version: schema,
    generated_at: generatedAt,
    updated_at: isoAgo(2),
    freshness_target_seconds: freshnessTargetSeconds,
    redaction_policy: "aggregate_public_market_context_only",
    ...(key === "opportunities" ? { source_artifact: "raven_opportunity_projection" } : {}),
    data: key === "opportunities" ? { generated_at: generatedAt, ...data } : data,
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function assetBinding(assets = {}) {
  return {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      return path in assets ? jsonResponse(assets[path]) : new Response("not found", { status: 404 });
    },
  };
}

function environment(assets = {}) {
  return {
    RAVENOS_PUBLIC_ORIGIN_URL: ORIGIN,
    RAVENOS_PUBLIC_ORIGIN_TOKEN: "server-only-test-token",
    ASSETS: assetBinding(assets),
  };
}

function geckoTrendingFixture(network, {
  pool = "0x1111111111111111111111111111111111111111",
  token = "0x2222222222222222222222222222222222222222",
  quote = "0x3333333333333333333333333333333333333333",
  symbol = "TOKEN",
  name = "Test Token",
} = {}) {
  return {
    data: [{
      id: `${network}_${pool}`,
      type: "pool",
      attributes: {
        address: pool,
        name: `${symbol} / USDC`,
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
        symbol,
        name,
        decimals: 18,
        image_url: "https://coin-images.coingecko.com/coins/images/1/large/test.png",
      },
    }, {
      id: `${network}_${quote}`,
      type: "token",
      attributes: {
        address: quote,
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        image_url: "https://coin-images.coingecko.com/coins/images/2/large/usdc.png",
      },
    }, {
      id: `${network}-dex`,
      type: "dex",
      attributes: { name: network === "solana" ? "Raydium" : network === "base" ? "Aerodrome" : "Uniswap V3" },
    }],
  };
}

function spotRadarFixture({ generatedAt = isoAgo(10) } = {}) {
  const poolAddress = "health-pool-address";
  const instrumentId = `solana:pool:${poolAddress}`;
  return buildDiscoverRadarProjection([{
    instrument_id: instrumentId,
    source_type: "market_activity",
    market_type: "spot",
    chain: "Solana",
    chain_id: "solana",
    venue: "pumpswap",
    identity_scope: "exact_pool",
    symbol: "HEALTH",
    name: "Health Fixture",
    token_address: "health-token-address",
    quote_token_address: "health-quote-address",
    quote_symbol: "SOL",
    pool_address: poolAddress,
    observed_at: generatedAt,
    age_seconds: 10,
    context_state: "current",
    market: {
      price_usd: 0.01,
      liquidity_usd: 90_000,
      market_cap_usd: 400_000,
      price_change_5m_pct: 2,
      volume_usd_5m: 18_000,
      buys_5m: 28,
      sells_5m: 18,
      buyers_5m: 20,
      sellers_5m: 14,
    },
    registry: {
      state: "tracking",
      first_seen_at: isoAgo(900),
      last_seen_at: generatedAt,
      observation_count: 2,
      admission_lanes: ["short_window_anomaly"],
      admission_reason: "Exact market is under observation",
      retained_after_trending: false,
      event_evidence_append_only: true,
    },
    research_only: true,
    actionable: false,
    execution_available: false,
  }], {
    timeframe: "5m",
    generatedAt,
    nowMs: Date.parse(generatedAt),
    sourceState: "current",
  });
}

test("Worker serves current origin intelligence with explicit delivery provenance", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(init.headers["x-ravenos-public-token"], "server-only-test-token");
    assert.equal(String(url), `${ORIGIN}/brief.json?projection=2`);
    return jsonResponse(projection(
      "brief",
      "ravenos_brief_public_origin_v1",
      { one_sentence_read: "Current Raven evidence is connected." },
    ));
  };
  try {
    const response = await worker.fetch(new Request("https://ravenos.xyz/api/brief"), environment());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-ravenos-data-source"), "current_public_origin");
    assert.equal(response.headers.get("x-ravenos-freshness"), "fresh");
    assert.equal(response.headers.has("x-ravenos-public-token"), false);
    const body = await response.json();
    assert.equal(body.data.one_sentence_read, "Current Raven evidence is connected.");
    assert.equal(body.delivery.source, "current_public_origin");
    assert.equal(JSON.stringify(body).includes("server-only-test-token"), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Worker opportunity route is backed by the current Census projection", async () => {
  const projections = {
    opportunities: projection(
      "opportunities",
      "ravenos_opportunity_census_public_origin_v1",
      {
        schema_version: "ravenos_opportunity_census_public_v1",
        source_state: "current",
        population: { decision_observations: 1200, matured_path_windows: 700 },
        opportunities: {
          rows: [{
            public_opportunity_id: "rop_fixture",
            instrument_id: "hyperliquid:perp:SOL",
            instrument: "SOL-PERP",
            context_state: "current",
            research_only: true,
            execution_available: false,
          }],
        },
        spot_attention: {
          schema_version: "ravenos.token_attention.v1",
          generated_at: isoAgo(10),
          state: "current",
          age_seconds: 10,
          row_count: 1,
          rows: [{
            public_attention_id: "rta_fixture",
            instrument_id: "spot_fixture",
            market_type: "spot",
            chain: "Solana",
            venue: "Meteora",
            identity_scope: "exact_pool",
            symbol: "RETIRE",
            name: "Retire",
            token_address: "11111111111111111111111111111111",
            pool_address: "22222222222222222222222222222222",
            observed_at: isoAgo(10),
            movement_state: "Activity accelerating",
            what_changed: "Price rose while volume and independent activity expanded.",
            risk: "Short-window movement still needs follow-through.",
            market: {
              liquidity_usd: 80_000,
              price_change_5m_pct: 8.5,
              price_change_1h_pct: 18,
              price_change_24h_pct: 31,
              buys_5m: 64,
              sells_5m: 26,
              traders_5m: 72,
              buys_1h: 320,
              sells_1h: 130,
              traders_1h: 240,
              buys_24h: 1_280,
              sells_24h: 520,
              traders_24h: 680,
              volume_usd_5m: 14_000,
              volume_usd_1h: 92_000,
              volume_usd_24h: 510_000,
            },
            broader_attention: {
              state: "raven_observed_first",
              raven_observed_first: true,
              lead_seconds: 1_200,
              summary: "Raven recorded this market 20m before broader attention appeared.",
            },
            research_only: true,
            actionable: false,
            execution_available: false,
          }],
          selection: {
            ranked_trade_list: false,
            broader_attention_affects_ranking: false,
          },
          execution_boundary: {
            research_only: true,
            actionable: false,
            signing_available: false,
            submission_available: false,
            capital_assigned: 0,
          },
        },
        discovery_radar: spotRadarFixture(),
      },
      isoAgo(10),
      3600,
    ),
    claims: projection("claims", "ravenos_claim_lineage_public_origin_v2", {
      lineage_version: "2.0",
      current_claims: [{ surface: "opportunity", headline: "Older claim context" }],
      recent_raven_reads: [],
    }),
    outcomes: projection("outcomes", "ravenos_outcomes_public_origin_v1", {
      recent_raven_reads: [],
      outcomes: [{
        chain: "solana",
        cap_band: "fresh_pairs",
        window: "24h",
        public_safe: true,
        usable_sample: 31,
        median_h6_move_pct: -1.4,
        claim_id: "claim_spot_fixture",
        evidence_contract: {
          observation_window: { label: "24h" },
          settlement_window: { label: "6h post-observation measurement" },
        },
      }, {
        chain: "solana",
        cap_band: "participant_cohorts",
        window: "live",
        public_safe: true,
        usable_sample: 88,
        source: "jupiter_helius_public_cohort_validation",
        median_mfe_pct: 21.7,
        claim_id: "claim_cohort_fixture",
        evidence_contract: {
          observation_window: { label: "live" },
          settlement_window: { label: "6h post-observation measurement" },
        },
      }],
    }),
    behavior: projection("behavior", "ravenos_behavior_public_origin_v1", {
      rows: [
        {
          chain: "solana",
          cap_band: "participant_cohorts",
          window: "live",
          public_safe: true,
          usable_sample: 88,
          observed_sample: 94,
          confidence: "medium",
          derived_state: "participation rewarding",
          plain_language_summary: "Jupiter Velocity participation on Solana is mixed or still unclear.",
        },
        {
          chain: "solana",
          cap_band: "fresh_pairs",
          window: "24h",
          public_safe: true,
          usable_sample: 31,
          observed_sample: 44,
          confidence: "medium",
          derived_state: "participation punishing",
        },
      ],
    }),
  };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const key = new URL(url).pathname.split("/").pop().replace(/\.json$/, "");
    return projections[key] ? jsonResponse(projections[key]) : jsonResponse({}, 404);
  };
  try {
    const response = await worker.fetch(new Request("https://ravenos.xyz/api/opportunity"), environment());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.schema_version, "ravenos.opportunity_workspace.v2");
    assert.equal(body.census.population.decision_observations, 1200);
    assert.equal(body.census.opportunities.rows[0].instrument_id, "hyperliquid:perp:SOL");
    assert.equal(body.census.opportunities.rows[0].execution_available, false);
    assert.equal(body.census.spot_attention.schema_version, "ravenos.token_attention.v1");
    assert.equal(body.census.spot_attention.rows[0].identity_scope, "exact_pool");
    assert.equal(body.census.spot_attention.rows[0].market.traders_24h, 680);
    assert.equal(body.census.spot_attention.rows[0].market.volume_usd_1h, 92_000);
    assert.equal(body.census.spot_attention.rows[0].broader_attention.raven_observed_first, true);
    assert.equal(body.census.spot_attention.selection.broader_attention_affects_ranking, false);
    assert.equal(body.census.spot_attention.execution_boundary.signing_available, false);
    assert.equal(body.census.spot_attention.execution_boundary.submission_available, false);
    assert.equal(body.census.lane_freshness.spot_raven.producer_state, "operational");
    assert.equal(body.census.lane_freshness.spot_raven.tracked_exact_markets, 1);
    assert.equal(body.census.lane_freshness.spot_raven.qualified_read_count, 0);
    assert.equal(body.current_claim_context.headline, "Older claim context");
    assert.equal(body.participation_payoff.schema_version, "ravenos.participation_payoff.v1");
    assert.deepEqual(
      body.participation_payoff.insights.map((row) => [row.state, row.subject]),
      [["rewarding", "Solana cohorts"], ["punishing", "Solana fresh pairs"]],
    );
    assert.equal(body.participation_payoff.measurement.causal_claim, false);
    assert.equal(
      body.behavior_context.rows[0].plain_language_summary,
      "High-velocity token participation on Solana is mixed or still unclear.",
    );
    assert.doesNotMatch(JSON.stringify(body.behavior_context), /Jupiter Velocity/i);
    assert.equal(body.current_opportunity.instrument_id, "hyperliquid:perp:SOL");
    assert.equal(body.selection.state, "default_current_row");
    assert.equal(body.delivery.source, "current_public_origin");
    assert.equal(body.delivery.fallback, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Worker serves bounded exact-pool Solana, Base, Ethereum, and Robinhood Chain activity without relabeling it as Raven", async () => {
  const providerSecret = "server-only-market-pulse-test-token";
  const solanaPool = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosg3Gx";
  const solanaToken = "So11111111111111111111111111111111111111112";
  const solanaQuote = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.origin === new URL(ORIGIN).origin && url.pathname.endsWith("/opportunities.json")) return jsonResponse({}, 503);
    assert.equal(init.headers["x-cg-pro-api-key"], providerSecret);
    assert.equal(url.searchParams.get("duration"), "5m");
    assert.equal(url.searchParams.get("include"), "base_token,quote_token,dex");
    if (url.pathname.includes("/networks/solana/")) {
      return jsonResponse(geckoTrendingFixture("solana", {
        pool: solanaPool,
        token: solanaToken,
        quote: solanaQuote,
        symbol: "RAVEN",
        name: "Raven Test",
      }));
    }
    if (url.pathname.includes("/networks/base/")) return jsonResponse(geckoTrendingFixture("base"));
    if (url.pathname.includes("/networks/eth/")) {
      return jsonResponse(geckoTrendingFixture("eth", {
        pool: "0x4444444444444444444444444444444444444444",
        token: "0x5555555555555555555555555555555555555555",
        quote: "0x6666666666666666666666666666666666666666",
        symbol: "WETH",
        name: "Wrapped Ether",
      }));
    }
    if (url.pathname.includes("/networks/robinhood/")) {
      return jsonResponse(geckoTrendingFixture("robinhood", {
        pool: "0x7777777777777777777777777777777777777777",
        token: "0x8888888888888888888888888888888888888888",
        quote: "0x9999999999999999999999999999999999999999",
        symbol: "RUNNER",
        name: "The Runner",
      }));
    }
    throw new Error(`unexpected_url:${url.pathname}`);
  };
  try {
    const response = await worker.fetch(
      new Request("https://ravenos.xyz/api/onchain/trending?chains=solana,base,ethereum,robinhood&duration=5m"),
      {
        ...environment(),
        ONCHAIN_CHART_PROVIDER: "coingecko",
        ONCHAIN_CHART_PROVIDER_PLAN: "basic",
        ONCHAIN_CHART_PROVIDER_COMMERCIAL: "true",
        ONCHAIN_CHART_PROVIDER_SECRET: providerSecret,
      },
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /s-maxage=30/);
    const body = await response.json();
    assert.equal(body.schema_version, "ravenos.onchain_market_pulse.v1");
    assert.equal(body.safe_public, true);
    assert.equal(body.state, "current");
    assert.equal(body.rows.length, 4);
    assert.equal(body.discovery_radar.schema_version, "ravenos.discover_radar.v1");
    assert.equal(body.discovery_radar.timeframe, "5m");
    assert.equal(body.discovery_radar.classifier.monitor_eligible, false);
    assert.equal(body.discovery_radar.monitor_safety.enabled, false);
    assert.deepEqual(body.rows.map((row) => row.chain_id), ["solana", "base", "ethereum", "robinhood"]);
    const solana = body.rows.find((row) => row.chain_id === "solana");
    assert.equal(solana.pool_address, solanaPool);
    assert.equal(solana.token_address, solanaToken);
    assert.equal(solana.quote_token_address, solanaQuote);
    assert.equal(solana.instrument_id, `solana:pool:${solanaPool}`);
    assert.ok(body.rows.every((row) => row.identity_scope === "exact_pool"));
    assert.ok(body.rows.every((row) => row.source_type === "market_activity"));
    assert.ok(body.rows.every((row) => row.instrument_id === `${row.chain_id}:pool:${row.pool_address}`));
    assert.ok(body.rows.every((row) => row.research_only === true && row.execution_available === false));
    assert.ok(body.rows.every((row) => row.discovery.schema_version === "ravenos.discover_market.v1"));
    assert.ok(body.rows.every((row) => row.discovery.raven_evidence_state.raven_signal === false));
    assert.ok(body.rows.every((row) => row.discovery.primary_behavior_state.value === "forming"));
    assert.ok(body.rows.every((row) => row.discovery.velocity_state.score.scale_max === 99));
    assert.ok(body.rows.every((row) => row.discovery.velocity_state.score.raven_confidence === false));
    assert.equal(body.provenance.raven_signal, false);
    assert.equal(body.discovery_lanes.robinhood_velocity, true);
    assert.equal(body.rows.find((row) => row.chain_id === "robinhood").discovery_source, "coingecko_robinhood_trending");
    assert.equal(body.execution_boundary.signing_available, false);
    assert.equal(body.execution_boundary.submission_available, false);
    assert.equal(JSON.stringify(body).includes(providerSecret), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Worker merges Jupiter token velocity into a verified exact Solana pool without leaking credentials", async () => {
  const coinGeckoSecret = "server-only-gecko-velocity-token";
  const jupiterSecret = "server-only-jupiter-velocity-token";
  const tokenAddress = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
  const poolAddress = "44444444444444444444444444444444";
  const quoteAddress = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.origin === new URL(ORIGIN).origin && url.pathname.endsWith("/opportunities.json")) return jsonResponse({}, 503);
    if (url.hostname === "api.jup.ag") {
      assert.equal(init.headers["x-api-key"], jupiterSecret);
      assert.equal(url.pathname, "/tokens/v2/toptrending/1h");
      assert.equal(url.searchParams.get("limit"), "20");
      return jsonResponse([{
        id: tokenAddress,
        name: "Jupiter",
        symbol: "JUP",
        icon: "https://static.jup.ag/jup/icon.png",
        usdPrice: 1.12,
        mcap: 3_100_000_000,
        fdv: 7_800_000_000,
        liquidity: 58_000_000,
        holderCount: 485_200,
        organicScore: 92.4,
        organicScoreLabel: "high",
        isVerified: true,
        firstPool: { createdAt: "2024-01-31T00:00:00Z" },
        stats5m: { priceChange: 6.2, volumeChange: 88, buyVolume: 190_000, sellVolume: 70_000, numBuys: 320, numSells: 130, numTraders: 280, numOrganicBuyers: 190, numNetBuyers: 120 },
        stats1h: { priceChange: 14.8, volumeChange: 134, buyVolume: 2_100_000, sellVolume: 740_000, numBuys: 2_800, numSells: 1_100, numTraders: 1_940, numOrganicBuyers: 1_260, numNetBuyers: 760 },
        stats24h: { priceChange: 31.5, volumeChange: 56, buyVolume: 18_500_000, sellVolume: 10_200_000, numBuys: 18_400, numSells: 11_800, numTraders: 8_900, numOrganicBuyers: 5_200, numNetBuyers: 2_900 },
      }]);
    }
    if (url.hostname === "api.dexscreener.com") {
      assert.match(url.pathname, /^\/tokens\/v1\/solana\//);
      assert.ok(decodeURIComponent(url.pathname).includes(tokenAddress));
      assert.equal(init.headers.accept, "application/json");
      return jsonResponse([{
        chainId: "solana",
        dexId: "meteora",
        pairAddress: poolAddress,
        pairCreatedAt: Date.now() - (180 * 86_400_000),
        baseToken: { address: tokenAddress, symbol: "JUP", name: "Jupiter" },
        quoteToken: { address: quoteAddress, symbol: "USDC", name: "USD Coin" },
        priceUsd: "1.12",
        liquidity: { usd: 4_200_000 },
        volume: { h24: 16_500_000 },
        txns: { h24: { buys: 7_300, sells: 5_100 } },
        marketCap: 3_100_000_000,
        fdv: 7_800_000_000,
        priceChange: { h24: 31.5 },
      }]);
    }
    assert.equal(init.headers["x-cg-pro-api-key"], coinGeckoSecret);
    assert.equal(url.searchParams.get("duration"), "1h");
    return jsonResponse(geckoTrendingFixture("solana", {
      pool: "77777777777777777777777777777777",
      token: "88888888888888888888888888888888",
      quote: quoteAddress,
      symbol: "SECOND",
      name: "Second Token",
    }));
  };
  try {
    const response = await worker.fetch(
      new Request("https://ravenos.xyz/api/onchain/trending?chains=solana&duration=1h"),
      {
        ...environment(),
        ONCHAIN_CHART_PROVIDER: "coingecko",
        ONCHAIN_CHART_PROVIDER_PLAN: "basic",
        ONCHAIN_CHART_PROVIDER_COMMERCIAL: "true",
        ONCHAIN_CHART_PROVIDER_SECRET: coinGeckoSecret,
        JUPITER_API_KEY: jupiterSecret,
      },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provenance.provider, "jupiter_tokens_v2 + coingecko_onchain");
    assert.equal(body.provenance.role, "token_velocity_plus_exact_pool_market_activity");
    assert.equal(body.discovery_lanes.jupiter_velocity, true);
    assert.equal(body.discovery_lanes.meteora_exact_pools, true);
    const velocity = body.rows.find((row) => row.source_type === "jupiter_velocity");
    assert.equal(velocity.instrument_id, `solana:pool:${poolAddress}`);
    assert.equal(velocity.identity_scope, "exact_pool");
    assert.equal(velocity.evidence_scope, "exact_token_flow_plus_exact_pool_route");
    assert.equal(velocity.token_address, tokenAddress);
    assert.equal(velocity.quote_token_address, quoteAddress);
    assert.equal(velocity.pool_address, poolAddress);
    assert.equal(velocity.venue, "meteora");
    assert.equal(velocity.market.price_change_1h_pct, 14.8);
    assert.equal(velocity.market.traders_1h, 1_940);
    assert.equal(velocity.jupiter.organic_score, 92.4);
    assert.equal(velocity.jupiter.metric_scope, "exact_token");
    assert.equal(velocity.jupiter.route_scope, "best_current_exact_pool");
    assert.equal(velocity.research_only, true);
    assert.equal(velocity.execution_available, false);
    assert.equal(velocity.discovery.raven_evidence_state.raven_signal, false);
    assert.equal(velocity.discovery.velocity_state.score.score_kind, "velocity_ranking");
    assert.equal(velocity.discovery.velocity_state.score.scale_max, 99);
    assert.equal(JSON.stringify(body).includes(coinGeckoSecret), false);
    assert.equal(JSON.stringify(body).includes(jupiterSecret), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Worker reuses persistent exact-market history before publishing current acceleration", async () => {
  const poolAddress = "0x1111111111111111111111111111111111111111";
  const tokenAddress = "0x2222222222222222222222222222222222222222";
  const quoteAddress = "0x3333333333333333333333333333333333333333";
  const generatedAt = new Date().toISOString();
  const history = buildDiscoverRadarProjection([{
    instrument_id: `base:pool:${poolAddress}`,
    source_type: "market_activity",
    market_type: "spot",
    chain: "Base",
    chain_id: "base",
    venue: "Aerodrome",
    identity_scope: "exact_pool",
    symbol: "TOKEN",
    name: "Test Token",
    token_address: tokenAddress,
    quote_token_address: quoteAddress,
    quote_symbol: "USDC",
    pool_address: poolAddress,
    observed_at: generatedAt,
    context_state: "current",
    market: {
      price_usd: 1.25,
      liquidity_usd: 920_000,
      market_cap_usd: 84_000_000,
      price_change_5m_pct: 4.2,
      price_change_1h_pct: 8.4,
      volume_usd_5m: 42_000,
      volume_usd_1h: 280_000,
      buys_5m: 48,
      sells_5m: 20,
      buyers_5m: 36,
      sellers_5m: 18,
      buys_1h: 210,
      sells_1h: 122,
      buyers_1h: 140,
      sellers_1h: 90,
    },
    registry: {
      state: "tracking",
      first_seen_at: isoAgo(7_200),
      last_seen_at: generatedAt,
      observation_count: 4,
      first_seen_market_cap_usd: 70_000_000,
      primary_behavior_state: "continuation",
      admission_lanes: ["renewed_mature_activity"],
      admission_reason: "Renewed exact-market participation",
      retained_after_trending: true,
      event_evidence_append_only: true,
    },
    research_only: true,
    actionable: false,
    execution_available: false,
  }], { timeframe: "5m", generatedAt, nowMs: Date.parse(generatedAt), sourceState: "shadow" });
  const originProjection = projection("opportunities", "ravenos_opportunity_census_public_origin_v1", {
    schema_version: "ravenos_opportunity_census_public_v1",
    source_state: "delayed",
    opportunities: { rows: [] },
    discovery_radar: history,
  }, isoAgo(5_000), 3_600);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.origin === new URL(ORIGIN).origin && url.pathname.endsWith("/opportunities.json")) return jsonResponse(originProjection);
    if (url.pathname.includes("/networks/base/")) return jsonResponse(geckoTrendingFixture("base", { pool: poolAddress, token: tokenAddress, quote: quoteAddress }));
    throw new Error(`unexpected_url:${url}`);
  };
  try {
    const response = await worker.fetch(
      new Request("https://ravenos.xyz/api/onchain/trending?chains=base&duration=5m"),
      {
        ...environment(),
        ONCHAIN_CHART_PROVIDER: "coingecko",
        ONCHAIN_CHART_PROVIDER_PLAN: "basic",
        ONCHAIN_CHART_PROVIDER_COMMERCIAL: "true",
        ONCHAIN_CHART_PROVIDER_SECRET: "registry-history-provider-token",
      },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.state, "current");
    assert.equal(payload.freshness.state, "current");
    assert.equal(payload.provenance.role, "current_plus_retained_exact_pool_market_activity");
    assert.equal(payload.discovery_lanes.retained_exact_markets, 1);
    assert.deepEqual(payload.unavailable, []);
    assert.equal(payload.rows.length, 1);
    assert.equal(payload.rows[0].instrument_id, `base:pool:${poolAddress}`);
    assert.equal(payload.rows[0].discovery.measurements.historical_window_coverage.stored_observation_count, 4);
    assert.equal(payload.rows[0].discovery.velocity_state.score.availability, "available");
    assert.notEqual(payload.rows[0].discovery.primary_behavior_state.value, "forming");
    assert.equal(payload.rows[0].discovery.raven_evidence_state.raven_signal, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Worker hot-refreshes a retained exact pool before Discover can rank its old move", async () => {
  const poolAddress = "maCx5kp4Bp5UfATJ4oAS5AzezGbSFcZbEQTtwirB4ZL";
  const tokenAddress = "7sfXVCXdgAwGpef9phswScmLYZX9zKMftZumnu39xVfZ";
  const quoteAddress = "So11111111111111111111111111111111111111112";
  const oldObservedAt = isoAgo(15 * 60);
  const history = buildDiscoverRadarProjection([{
    instrument_id: `solana:pool:${poolAddress}`,
    source_type: "market_activity",
    market_type: "spot",
    chain: "Solana",
    chain_id: "solana",
    venue: "pumpswap",
    identity_scope: "exact_pool",
    symbol: "Poteto",
    name: "Poteto",
    token_address: tokenAddress,
    quote_token_address: quoteAddress,
    quote_symbol: "SOL",
    pool_address: poolAddress,
    observed_at: oldObservedAt,
    context_state: "current",
    market: {
      price_usd: 0.000030218,
      liquidity_usd: 14_087,
      market_cap_usd: 28_908,
      price_change_5m_pct: 329.45,
      price_change_1h_pct: 478.96,
      price_change_24h_pct: 478.96,
      volume_usd_5m: 68_071,
      volume_usd_1h: 557_818,
      volume_usd_24h: 557_818,
      buys_5m: 526,
      sells_5m: 429,
      buyers_5m: 180,
      sellers_5m: 177,
      buys_1h: 4_431,
      sells_1h: 3_947,
      buyers_1h: 950,
      sellers_1h: 922,
    },
    registry: {
      state: "retained",
      first_seen_at: isoAgo(16 * 60),
      last_seen_at: oldObservedAt,
      observation_count: 2,
      primary_behavior_state: "post_dump_resurrection",
      admission_lanes: ["short_window_anomaly", "recently_removed_from_trending"],
      admission_reason: "Material short-window move",
      retained_after_trending: true,
      event_evidence_append_only: true,
    },
    research_only: true,
    actionable: false,
    execution_available: false,
  }], {
    timeframe: "5m",
    generatedAt: oldObservedAt,
    nowMs: Date.parse(oldObservedAt),
    sourceState: "shadow",
  });
  const originProjection = projection("opportunities", "ravenos_opportunity_census_public_origin_v1", {
    schema_version: "ravenos_opportunity_census_public_v1",
    source_state: "delayed",
    opportunities: { rows: [] },
    discovery_radar: history,
  });
  const currentPoteto = geckoTrendingFixture("solana", {
    pool: poolAddress,
    token: tokenAddress,
    quote: quoteAddress,
    symbol: "Poteto",
    name: "Poteto",
  });
  currentPoteto.data = currentPoteto.data[0];
  Object.assign(currentPoteto.data.attributes, {
    base_token_price_usd: "0.000009483",
    fdv_usd: "9264.79",
    market_cap_usd: null,
    reserve_in_usd: "6693.79",
    price_change_percentage: { m5: "-4.224", h1: "-77.993", h24: "-77.993" },
    volume_usd: { m5: "184.74", h1: "528738.45", h24: "528738.45" },
    transactions: {
      m5: { buys: 3, sells: 10, buyers: 3, sellers: 10 },
      h1: { buys: 4_869, sells: 4_423, buyers: 2_209, sellers: 2_041 },
      h24: { buys: 4_869, sells: 4_423, buyers: 2_209, sellers: 2_041 },
    },
  });
  const otherPool = "5HueCGU8rMjxEXxiPuD5BDuRaCcLMb9a5Xagux7pD2Vn";
  const otherToken = "9xQeWvG816bUx9EPfEZnYv5Hh7gXnc9w1dBLk4pKxg4V";
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.origin === new URL(ORIGIN).origin && url.pathname.endsWith("/opportunities.json")) return jsonResponse(originProjection);
    if (url.pathname.includes(`/pools/${poolAddress}`)) return jsonResponse(currentPoteto);
    if (url.pathname.includes("/networks/solana/trending_pools")) {
      return jsonResponse(geckoTrendingFixture("solana", {
        pool: otherPool,
        token: otherToken,
        quote: quoteAddress,
        symbol: "OTHER",
        name: "Other Current Pool",
      }));
    }
    throw new Error(`unexpected_url:${url}`);
  };
  try {
    const response = await worker.fetch(
      new Request("https://ravenos.xyz/api/onchain/trending?chains=solana&duration=5m"),
      {
        ...environment(),
        ONCHAIN_CHART_PROVIDER: "coingecko",
        ONCHAIN_CHART_PROVIDER_PLAN: "basic",
        ONCHAIN_CHART_PROVIDER_COMMERCIAL: "true",
        ONCHAIN_CHART_PROVIDER_SECRET: "hot-watch-provider-token",
      },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    const poteto = payload.rows.find((row) => row.instrument_id === `solana:pool:${poolAddress}`);
    assert.ok(poteto);
    assert.equal(poteto.discovery_source, "retained_exact_pool_hot_watch");
    assert.equal(poteto.market.price_usd, 0.000009483);
    assert.equal(poteto.market.fdv_usd, 9264.79);
    assert.equal(poteto.market.liquidity_usd, 6693.79);
    assert.equal(poteto.market.price_change_5m_pct, -4.224);
    assert.equal(poteto.market.price_change_1h_pct, -77.993);
    assert.notEqual(poteto.market.price_change_5m_pct, 329.45);
    assert.equal(poteto.discovery.facts.freshness.state, "current");
    assert.equal(poteto.discovery.facts.freshness.target_seconds, 120);
    assert.equal(poteto.discovery.notability.primary_trigger.direction, "down");
    assert.equal(payload.discovery_lanes.hot_watch_attempted, 1);
    assert.equal(payload.discovery_lanes.hot_watch_refreshed, 1);
    assert.equal(JSON.stringify(payload).includes("hot-watch-provider-token"), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Worker keeps Velocity available from the retained exact-market registry during a provider outage", async () => {
  const poolAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const tokenAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const quoteAddress = "0xcccccccccccccccccccccccccccccccccccccccc";
  const generatedAt = new Date().toISOString();
  const history = buildDiscoverRadarProjection([{
    instrument_id: `base:pool:${poolAddress}`,
    source_type: "market_activity",
    market_type: "spot",
    chain: "Base",
    chain_id: "base",
    venue: "Aerodrome",
    identity_scope: "exact_pool",
    symbol: "KEEP",
    name: "Retained Candidate",
    token_address: tokenAddress,
    quote_token_address: quoteAddress,
    quote_symbol: "USDC",
    pool_address: poolAddress,
    observed_at: generatedAt,
    age_seconds: 0,
    context_state: "current",
    market: {
      price_usd: 0.42,
      liquidity_usd: 180_000,
      market_cap_usd: 1_200_000,
      price_change_5m_pct: 8.2,
      price_change_1h_pct: 21.4,
      price_change_24h_pct: 38.6,
      volume_usd_5m: 68_000,
      volume_usd_1h: 390_000,
      volume_usd_24h: 1_900_000,
      buys_5m: 84,
      sells_5m: 39,
      buyers_5m: 61,
      sellers_5m: 31,
      buys_1h: 330,
      sells_1h: 190,
      buyers_1h: 228,
      sellers_1h: 144,
      buys_24h: 1_920,
      sells_24h: 1_040,
      buyers_24h: 1_080,
      sellers_24h: 730,
    },
    registry: {
      state: "tracking",
      first_seen_at: isoAgo(3_600),
      last_seen_at: generatedAt,
      observation_count: 3,
      primary_behavior_state: "reacceleration",
      admission_lanes: ["short_window_anomaly"],
      admission_reason: "Short-window movement remained notable",
      retained_after_trending: true,
      event_evidence_append_only: true,
    },
    research_only: true,
    actionable: false,
    execution_available: false,
  }], { timeframe: "24h", generatedAt, nowMs: Date.parse(generatedAt), sourceState: "current" });
  const originProjection = projection("opportunities", "ravenos_opportunity_census_public_origin_v1", {
    schema_version: "ravenos_opportunity_census_public_v1",
    source_state: "delayed",
    opportunities: { rows: [] },
    discovery_radar: history,
  }, isoAgo(5_000), 3_600);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.origin === new URL(ORIGIN).origin && url.pathname.endsWith("/opportunities.json")) return jsonResponse(originProjection);
    if (url.pathname.includes("/networks/base/")) return jsonResponse({ error: "temporarily unavailable" }, 503);
    throw new Error(`unexpected_url:${url}`);
  };
  try {
    const response = await worker.fetch(
      new Request("https://ravenos.xyz/api/onchain/trending?chains=base&duration=24h"),
      {
        ...environment(),
        ONCHAIN_CHART_PROVIDER: "coingecko",
        ONCHAIN_CHART_PROVIDER_PLAN: "basic",
        ONCHAIN_CHART_PROVIDER_COMMERCIAL: "true",
        ONCHAIN_CHART_PROVIDER_SECRET: "registry-outage-provider-token",
      },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.state, "degraded");
    assert.equal(payload.freshness.state, "delayed");
    assert.equal(payload.provenance.role, "retained_exact_pool_registry");
    assert.equal(payload.rows.length, 1);
    assert.equal(payload.rows[0].instrument_id, `base:pool:${poolAddress}`);
    assert.equal(payload.rows[0].discovery_source, "retained_exact_pool_registry");
    assert.equal(payload.rows[0].raven_signal, false);
    assert.equal(payload.rows[0].discovery.raven_evidence_state.raven_signal, false);
    assert.deepEqual(payload.unavailable, [{ chain: "base", state: "temporarily_unavailable" }]);
    assert.equal(JSON.stringify(payload).includes("registry-outage-provider-token"), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Worker does not relabel an older claim as a current opportunity when Census is unavailable", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const key = new URL(url).pathname.split("/").pop().replace(/\.json$/, "");
    if (key === "claims") return jsonResponse(projection("claims", "ravenos_claim_lineage_public_origin_v2", {
      current_claims: [{ surface: "opportunity", headline: "Older claim context" }],
    }));
    return jsonResponse({}, 503);
  };
  try {
    const response = await worker.fetch(new Request("https://ravenos.xyz/api/opportunity"), environment());
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, "opportunity_census_projection_unavailable");
    assert.equal(body.census, null);
    assert.equal(body.current_opportunity, null);
    assert.equal(body.selected_opportunity, null);
    assert.equal("legacy_context" in body, false);
    assert.equal(body.historical_context.current_data_substituted, false);
    assert.equal(body.historical_context.replay_contract, "/api/replay");
    assert.match(body.message, /not substituted as current opportunities/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Worker health measures current product lanes without penalizing archival or retired services", async () => {
  const currentRadar = spotRadarFixture();
  const currentOpportunityProjection = projection(
    "opportunities",
    "ravenos_opportunity_census_public_origin_v1",
    {
      schema_version: "ravenos_opportunity_census_public_v1",
      source_state: "current",
      opportunities: { rows: [] },
      discovery_radar: currentRadar,
    },
    isoAgo(10),
    3_600,
  );
  const manifest = {
    schema_version: "ravenos_public_origin_manifest_v1",
    generated_at: isoAgo(2),
    safe_public: true,
    redaction_policy: "aggregate_public_market_context_only",
    endpoints: [
      ...["brief", "replay", "outcomes", "memory", "behavior", "perps", "opportunities", "claims"].map((key) => ({
        key,
        endpoint_path: `/public/ravenos/${key}.json`,
        payload_age_seconds: 10,
        freshness_target_seconds: key === "perps" ? 120 : 900,
      })),
      {
        key: "atlas",
        endpoint_path: "/public/ravenos/atlas.json",
        payload_age_seconds: 10,
        freshness_target_seconds: 900,
      },
      {
        key: "research",
        endpoint_path: "/public/ravenos/research.json",
        payload_age_seconds: 2_300_000,
        freshness_target_seconds: 900,
        source: "/srv/raven/app/private/research.json",
      },
    ],
    failed: [],
  };
  const status = {
    schema_version: "ravenos_public_publish_status_v1",
    generated_at: isoAgo(2),
    endpoints_published: 10,
    endpoints_failed: 0,
    private_leak_guard_passed: true,
    output_dir: "/srv/raven/app/private/path-that-must-not-leak",
    stale_endpoints: ["research"],
    validation_failures: [],
  };
  const terminalHealth = {
    schema_version: "customer_trade_terminal_health_snapshot.v1",
    generated_at: isoAgo(5),
    terminal_availability: "fresh",
    market_data_availability: "fresh",
    quote_availability: "unknown",
    review_availability: "unavailable",
    components: [
      { component: "solana_rpc", state: "fresh" },
      { component: "market_chart_data", state: "fresh", private_path: "/srv/private" },
      { component: "perp_market_context", state: "fresh" },
      { component: "evidence_persistence", state: "fresh" },
    ],
    public_warnings: [],
    degraded_reasons: [],
  };
  const byPath = {
    "/public/ravenos/manifest.json": manifest,
    "/public/ravenos/status.json": status,
    "/public/ravenos/terminal_health.json": terminalHealth,
    "/public/ravenos/opportunities.json": currentOpportunityProjection,
  };
  const previousFetch = globalThis.fetch;
  let hyperliquidAvailable = true;
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === "api.hyperliquid.xyz") {
      const body = JSON.parse(String(init.body || "{}"));
      if (!hyperliquidAvailable || body.type !== "metaAndAssetCtxs") return jsonResponse({}, 503);
      return jsonResponse([
        { universe: [{ name: "HEALTH", maxLeverage: 10 }] },
        [{
          funding: "0.00001",
          openInterest: "1000",
          dayNtlVlm: "2500000",
          markPx: "100",
          midPx: "100",
          oraclePx: "99.98",
          prevDayPx: "98",
        }],
      ]);
    }
    return jsonResponse(byPath[parsed.pathname] || {}, byPath[parsed.pathname] ? 200 : 404);
  };
  try {
    const env = environment();
    const response = await worker.fetch(new Request("https://ravenos.xyz/api/health"), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.status, "ok");
    assert.equal(body.process_health.state, "operational");
    assert.equal(body.process_health.checks.customerAccounts, "not_configured");
    assert.equal(body.process_health.checks.accessApi, "not_configured");
    assert.equal(body.market_data_health.state, "fresh");
    assert.equal(body.intelligence_freshness.state, "fresh");
    assert.equal(body.intelligence_freshness.research.state, "historical");
    assert.equal(body.intelligence_freshness.research.source_freshness_state, "stale");
    assert.equal(body.intelligence_freshness.research.blocking, false);
    assert.equal(body.atlas_health.state, "fresh");
    assert.equal(body.atlas_health.blocking, true);
    assert.equal(body.atlas_health.operational, true);
    assert.equal(body.raven_read_health.state, "fresh");
    assert.equal(body.raven_read_health.mode, "deterministic_structured_projection");
    assert.equal(body.raven_read_health.spot_tokens.producer_state, "operational");
    assert.equal(body.raven_read_health.spot_tokens.expected_update_seconds, 90);
    assert.equal(body.raven_read_health.spot_tokens.maximum_healthy_age_seconds, 120);
    assert.equal(body.raven_read_health.spot_tokens.tracked_exact_markets, 1);
    assert.equal(body.raven_read_health.spot_tokens.qualified_read_count, 0);
    assert.equal(body.raven_read_health.spot_tokens.provider_rank_creates_raven_signal, false);
    assert.equal(body.narrator_freshness.state, "not_required");
    assert.equal(body.narrator_freshness.blocking, false);
    assert.equal(body.projection_health.state, "operational");
    assert.equal(body.publisher_health.state, "operational");
    assert.equal(body.publisher_health.blocking, true);
    assert.equal(body.execution_health.state, "disabled");
    assert.equal(body.execution_health.blocking, false);
    assert.equal(body.execution_health.signing_available, false);
    assert.equal(body.execution_health.submission_available, false);
    assert.equal(JSON.stringify(body).includes("/srv/"), false);

    byPath["/public/ravenos/opportunities.json"] = projection(
      "opportunities",
      "ravenos_opportunity_census_public_origin_v1",
      {
        schema_version: "ravenos_opportunity_census_public_v1",
        source_state: "current",
        opportunities: { rows: [] },
        discovery_radar: spotRadarFixture({ generatedAt: isoAgo(121) }),
      },
      isoAgo(10),
      3_600,
    );
    const expiredTruthWindowResponse = await worker.fetch(new Request("https://ravenos.xyz/api/health"), env);
    const expiredTruthWindow = await expiredTruthWindowResponse.json();
    assert.equal(expiredTruthWindow.status, "degraded");
    assert.equal(expiredTruthWindow.raven_read_health.spot_tokens.producer_state, "delayed");
    assert.equal(expiredTruthWindow.raven_read_health.spot_tokens.maximum_healthy_age_seconds, 120);
    byPath["/public/ravenos/opportunities.json"] = currentOpportunityProjection;

    manifest.endpoints.find((row) => row.key === "opportunities").payload_age_seconds = 5_000;
    byPath["/public/ravenos/opportunities.json"] = projection(
      "opportunities",
      "ravenos_opportunity_census_public_origin_v1",
      {
        schema_version: "ravenos_opportunity_census_public_v1",
        source_state: "delayed",
        opportunities: {
          rows: [{
            public_opportunity_id: "rop_current_lane_fixture",
            instrument_id: "hyperliquid:perp:SOL",
            instrument: "SOL-PERP",
            market_type: "perpetual",
            context_state: "current",
            observed_at: isoAgo(10),
            research_only: true,
            actionable: false,
            execution_available: false,
          }],
        },
        discovery_radar: currentRadar,
      },
      isoAgo(5_000),
      3_600,
    );
    const recoveredLaneResponse = await worker.fetch(new Request("https://ravenos.xyz/api/health"), env);
    const recoveredLane = await recoveredLaneResponse.json();
    const recoveredOpportunityHealth = recoveredLane.intelligence_freshness.core_endpoints
      .find((row) => row.key === "opportunities");
    assert.equal(recoveredLane.status, "ok");
    assert.equal(recoveredLane.intelligence_freshness.state, "fresh");
    assert.equal(recoveredLane.raven_read_health.state, "fresh");
    assert.equal(recoveredLane.raven_read_health.spot_tokens.producer_state, "operational");
    assert.equal(recoveredLane.raven_read_health.spot_tokens.qualified_read_count, 0);
    assert.equal(recoveredOpportunityHealth.state, "fresh");
    assert.equal(recoveredOpportunityHealth.projection_scope, "current_rows_only");
    assert.equal(recoveredOpportunityHealth.aggregate_freshness_state, "stale");
    assert.equal(recoveredOpportunityHealth.current_rows_only, true);
    assert.equal(recoveredOpportunityHealth.stale_aggregate_counts_included, false);
    assert.equal(recoveredOpportunityHealth.historical_context_substituted, false);

    delete byPath["/public/ravenos/opportunities.json"];
    const rejectedLaneResponse = await worker.fetch(new Request("https://ravenos.xyz/api/health"), env);
    const rejectedLane = await rejectedLaneResponse.json();
    const rejectedOpportunityHealth = rejectedLane.intelligence_freshness.core_endpoints
      .find((row) => row.key === "opportunities");
    assert.equal(rejectedLane.status, "degraded");
    assert.equal(rejectedLane.raven_read_health.state, "degraded");
    assert.equal(rejectedLane.raven_read_health.spot_tokens.producer_state, "unavailable");
    assert.equal(rejectedOpportunityHealth.state, "stale");
    assert.equal("projection_scope" in rejectedOpportunityHealth, false);
    byPath["/public/ravenos/opportunities.json"] = currentOpportunityProjection;
    manifest.endpoints.find((row) => row.key === "opportunities").payload_age_seconds = 10;

    terminalHealth.market_data_availability = "degraded";
    terminalHealth.terminal_availability = "degraded";
    terminalHealth.components.find((row) => row.component === "market_chart_data").state = "degraded";
    const recoveredMarketResponse = await worker.fetch(new Request("https://ravenos.xyz/api/health"), env);
    const recoveredMarket = await recoveredMarketResponse.json();
    assert.equal(recoveredMarket.status, "ok");
    assert.equal(recoveredMarket.market_data_health.state, "fresh");
    assert.equal(recoveredMarket.market_data_health.snapshot_state, "degraded");
    assert.equal(recoveredMarket.market_data_health.revalidated_by, "live_hyperliquid_customer_route");
    assert.equal(recoveredMarket.market_data_health.component_states.market_chart_data, "fresh");
    assert.equal(recoveredMarket.market_data_health.exact_market_count, 1);

    hyperliquidAvailable = false;
    const rejectedMarketResponse = await worker.fetch(new Request("https://ravenos.xyz/api/health"), env);
    const rejectedMarket = await rejectedMarketResponse.json();
    assert.equal(rejectedMarket.status, "degraded");
    assert.equal(rejectedMarket.market_data_health.state, "degraded");
    assert.equal("revalidated_by" in rejectedMarket.market_data_health, false);
    terminalHealth.market_data_availability = "fresh";
    terminalHealth.terminal_availability = "fresh";
    terminalHealth.components.find((row) => row.component === "market_chart_data").state = "fresh";

    manifest.endpoints.find((row) => row.key === "atlas").payload_age_seconds = 1_900;
    const delayedAtlasResponse = await worker.fetch(new Request("https://ravenos.xyz/api/health"), env);
    const delayedAtlas = await delayedAtlasResponse.json();
    assert.equal(delayedAtlas.status, "ok");
    assert.equal(delayedAtlas.atlas_health.state, "delayed");
    assert.equal(delayedAtlas.atlas_health.operational, true);

    manifest.endpoints.find((row) => row.key === "atlas").payload_age_seconds = 8_000;
    const staleAtlasResponse = await worker.fetch(new Request("https://ravenos.xyz/api/health"), env);
    const staleAtlas = await staleAtlasResponse.json();
    assert.equal(staleAtlas.status, "degraded");
    assert.equal(staleAtlas.atlas_health.state, "stale");
    assert.equal(staleAtlas.atlas_health.operational, false);

    manifest.endpoints.find((row) => row.key === "atlas").payload_age_seconds = 10;
    status.generated_at = isoAgo(5_000);
    const missedPublisherResponse = await worker.fetch(new Request("https://ravenos.xyz/api/health"), env);
    const missedPublisher = await missedPublisherResponse.json();
    assert.equal(missedPublisher.status, "degraded");
    assert.equal(missedPublisher.publisher_health.state, "degraded");
    assert.equal(missedPublisher.publisher_health.blocking, true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("customer account and billing endpoints fail closed when no authenticated customer system exists", async () => {
  const env = environment();
  const access = await worker.fetch(new Request("https://ravenos.xyz/api/access?wallet=private-wallet-value"), env);
  assert.equal(access.status, 503);
  const accessBody = await access.json();
  assert.equal(accessBody.error, "legacy_customer_access_quarantined");
  assert.equal(accessBody.customer_system.wallet_role, "optional_market_context_only");
  assert.equal(JSON.stringify(accessBody).includes("private-wallet-value"), false);
  assert.equal(JSON.stringify(accessBody).includes("threshold"), false);

  for (const path of ["/api/stripe/checkout", "/api/stripe/portal", "/api/stripe/webhook"]) {
    const response = await worker.fetch(new Request(`https://ravenos.xyz${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }), env);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, "legacy_billing_quarantined");
  }
});

test("legacy commercial and synthetic token surfaces redirect to truthful current routes", async () => {
  const env = environment();
  for (const [path, target] of [["/pro/", "/pricing/"], ["/upgrade/", "/pricing/"], ["/token/", "/terminal/"]]) {
    const response = await worker.fetch(new Request(`https://ravenos.xyz${path}`), env);
    assert.equal(response.status, 308);
    assert.equal(new URL(response.headers.get("location")).pathname, target);
  }
});
