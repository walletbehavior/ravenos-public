import assert from "node:assert/strict";
import test from "node:test";

import worker from "../worker.mjs";

const TOKEN = "0x2112a316a2e56d7300092e5a41d2a84dd11d3bd6";
const QUOTE = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const POOL = "0x8366a39cc670b4001a1121b8f6a443a643e40951";

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function tokenFixture(overrides = {}) {
  return {
    chain: "robinhood",
    address: TOKEN,
    name: "Dexchart",
    symbol: "CHART",
    launchpad: "ponsV2",
    kind: "POOL",
    tier: "ACTIVE",
    status: "BONDING",
    launchTime: new Date(Date.now() - 3_600_000).toISOString(),
    lastActivityAt: new Date(Date.now() - 1_000).toISOString(),
    migratedAt: null,
    progressBps: 1721,
    priceUsd: 0.000016,
    marketCapUsd: 6490,
    liquidityUsd: 3.58,
    volume1hUsd: 2789,
    volume24hUsd: 85_381,
    txns24h: 848,
    buys24h: 464,
    sells24h: 384,
    holderCount: 81,
    top10Pct: 72.25,
    risk: "unknown",
    riskWarnings: 0,
    dexPaid: false,
    imageUrl: "https://gmgn.ai/external-res/provider-branded.webp",
    quoteToken: QUOTE,
    quoteSymbol: "ETH",
    ...overrides,
  };
}

function activeEnv(overrides = {}) {
  return {
    RAVENOS_DEXCH_DISCOVERY_ENABLED: "1",
    RAVENOS_DEXCH_COMMERCIAL_USE_ACKNOWLEDGED: "1",
    ...overrides,
  };
}

function enforcedReleaseEnv(overrides = {}) {
  const releaseId = "ravenos-dexchtest12-0123456789abcdef";
  const sourceCommit = "0123456789abcdef0123456789abcdef01234567";
  const assetDigest = "a".repeat(64);
  const contractVersion = "ravenos_public_origin_manifest_v1";
  const assets = {
    "/ravenos_release.json": {
      schema_version: "ravenos.release.v1",
      release_id: releaseId,
      source_commit: sourceCommit,
      public_build_id: "dexchtest12",
      static_asset_manifest_sha256: assetDigest,
      public_origin_contract_version: contractVersion,
    },
    "/ravenos_build.json": {
      release_id: releaseId,
      source_commit: sourceCommit,
      public_build_id: "dexchtest12",
      static_asset_manifest_sha256: assetDigest,
    },
    "/ravenos_deploy_manifest.json": {
      schema_version: "ravenos.deploy.v2",
      release_id: releaseId,
      source_commit: sourceCommit,
      static_asset_manifest_sha256: assetDigest,
      artifact_content_sha256: "b".repeat(64),
      files: ["index.html"],
    },
  };
  return {
    RAVENOS_RELEASE_ENFORCE: "1",
    RAVENOS_RELEASE_ID: releaseId,
    RAVENOS_SOURCE_COMMIT: sourceCommit,
    RAVENOS_STATIC_ASSET_MANIFEST_SHA256: assetDigest,
    RAVENOS_PUBLIC_ORIGIN_CONTRACT_VERSION: contractVersion,
    CF_VERSION_METADATA: {
      id: "11111111-2222-3333-4444-555555555555",
      tag: releaseId,
      timestamp: "2026-09-03T00:00:00Z",
    },
    ASSETS: {
      async fetch(request) {
        const payload = assets[new URL(request.url).pathname];
        return payload ? json(payload) : new Response("not found", { status: 404 });
      },
    },
    ...overrides,
  };
}

test("public Dexch discovery route is normalized, bounded and authority-free", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.dexch.art");
    assert.equal(url.pathname, "/api/v1/tokens");
    assert.equal(url.searchParams.get("minMcap"), "5000");
    assert.equal(url.searchParams.get("maxMcap"), "100000");
    return json({ data: [tokenFixture()] });
  };
  try {
    const response = await worker.fetch(new Request(
      "https://ravenos.xyz/api/discovery/tokens?chains=robinhood&limit=20&min_market_cap_usd=5000&max_market_cap_usd=100000",
    ), activeEnv());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.rows[0].chain_id, "eip155:4663");
    assert.equal(body.rows[0].canonical_identity.asset_id, `eip155:4663/erc20:${TOKEN}`);
    assert.equal(body.rows[0].evidence_class, "DEXCH_REPORTED");
    assert.equal(body.rows[0].image_url, null);
    assert.equal(body.rows[0].provenance.current_price_authority, false);
    assert.equal(body.execution_boundary.transaction_construction, false);
    assert.equal(body.execution_boundary.signing, false);
    assert.equal(JSON.stringify(body).includes("api.dexch.art"), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("release route stays unavailable when commercial use remains unresolved", async () => {
  let requested = false;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    requested = true;
    return json({ data: [] });
  };
  try {
    const response = await worker.fetch(
      new Request("https://ravenos.xyz/api/discovery/tokens?chains=robinhood"),
      enforcedReleaseEnv({ RAVENOS_DEXCH_DISCOVERY_ENABLED: "1" }),
    );
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "dexch_commercial_use_rights_not_acknowledged");
    assert.equal(requested, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("unknown query fields fail before any provider request", async () => {
  let requested = false;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    requested = true;
    return json({ data: [] });
  };
  try {
    const response = await worker.fetch(new Request("https://ravenos.xyz/api/discovery/tokens?chains=robinhood&raw=1"), activeEnv());
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "dexch_discovery_request_invalid");
    assert.equal(requested, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("current exact-pool rows receive token-creation and migration evidence without replacing market truth", async () => {
  const previousFetch = globalThis.fetch;
  const dexchRequests = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.origin === "https://api.dexch.art") {
      dexchRequests.push(url);
      return json({ data: [tokenFixture()] });
    }
    if (url.hostname === "api.coingecko.com" && url.pathname.includes("/trending_pools")) {
      return json({
        data: [{
          id: `robinhood_${POOL}`,
          type: "pool",
          attributes: {
            address: POOL,
            name: "CHART / ETH",
            pool_created_at: new Date(Date.now() - 1_800_000).toISOString(),
            base_token_price_usd: "0.000017",
            quote_token_price_usd: "2500",
            fdv_usd: "17000",
            market_cap_usd: "6800",
            reserve_in_usd: "4000",
            price_change_percentage: { m5: "2", h1: "6", h24: "10" },
            volume_usd: { m5: "500", h1: "3000", h24: "90000" },
            transactions: {
              m5: { buys: 8, sells: 4, buyers: 7, sellers: 4 },
              h1: { buys: 50, sells: 25, buyers: 35, sellers: 20 },
              h24: { buys: 464, sells: 384, buyers: 200, sellers: 180 },
            },
          },
          relationships: {
            base_token: { data: { id: `robinhood_${TOKEN}`, type: "token" } },
            quote_token: { data: { id: `robinhood_${QUOTE}`, type: "token" } },
            dex: { data: { id: "robinhood-uniswap", type: "dex" } },
          },
        }],
        included: [{
          id: `robinhood_${TOKEN}`,
          type: "token",
          attributes: { address: TOKEN, symbol: "CHART", name: "Dexchart", decimals: 18 },
        }, {
          id: `robinhood_${QUOTE}`,
          type: "token",
          attributes: { address: QUOTE, symbol: "ETH", name: "Ether", decimals: 18 },
        }, {
          id: "robinhood-uniswap",
          type: "dex",
          attributes: { name: "Uniswap" },
        }],
      });
    }
    if (url.hostname === "api.dexscreener.com" && url.pathname.includes("/tokens/v1/")) return json([]);
    return new Response("not found", { status: 404 });
  };
  try {
    const response = await worker.fetch(new Request(
      "https://ravenos.xyz/api/onchain/trending?chains=robinhood&duration=1h",
    ), activeEnv({
      ONCHAIN_CHART_PROVIDER_SECRET: "demo-key",
      ONCHAIN_CHART_PROVIDER_PLAN: "demo",
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    const row = body.rows.find((item) => item.token_address.toLowerCase() === TOKEN);
    assert.ok(row);
    assert.equal(row.market.price_usd, 0.000017);
    assert.equal(row.market.age_basis, "dexch_reported_token_creation");
    assert.ok(row.market.token_age_seconds >= 3_590);
    assert.ok(row.market.pool_age_seconds <= 1_900);
    assert.equal(row.lifecycle_evidence.provider, "dexch");
    assert.equal(row.lifecycle_evidence.raven_verified, false);
    assert.equal(body.discovery_lanes.dexch_lifecycle_enriched, 1);
    assert.equal(body.provenance.sources.dexch.current_price_authority, false);
    assert.equal(body.provenance.sources.dexch.execution_authority, false);
    assert.equal(dexchRequests.length, 4);
    assert.deepEqual(dexchRequests.map((url) => url.searchParams.get("preset")), [null, "new", "almost", "graduated"]);
    assert.equal(body.provenance.sources.dexch.token_rows, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
