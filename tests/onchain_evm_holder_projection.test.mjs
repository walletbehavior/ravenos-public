import assert from "node:assert/strict";
import test from "node:test";

import {
  OnchainEvmHolderProjectionContract,
  buildPublicEvmHolderProjection,
  resolvePublicEvmHolderRuntime,
} from "../lib/onchain_evm_holder_projection.mjs";
import worker from "../worker.mjs";

const POOL = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const QUOTE = "0x3333333333333333333333333333333333333333";
const OWNER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CONTRACT = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const API_KEY = "proapi_fixture_holder_key";

const CHAINS = Object.freeze({
  robinhood: { id: "4663", explorer: "https://robinhoodchain.blockscout.com/address/" },
  base: { id: "8453", explorer: "https://basescan.org/address/" },
  bsc: { id: "56", explorer: "https://bscscan.com/address/" },
  ethereum: { id: "1", explorer: "https://etherscan.io/address/" },
});

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function env() {
  return { RAVENOS_PUBLIC_EVM_HOLDERS_ENABLED: "1", BLOCKSCOUT_API_KEY: API_KEY };
}

function providerFetchFor(chain) {
  return async (input) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.blockscout.com");
    assert.equal(url.searchParams.get("apikey"), API_KEY);
    assert.match(url.pathname, new RegExp(`^/${CHAINS[chain].id}/api/v2/tokens/${TOKEN}`));
    if (url.pathname.endsWith("/holders")) {
      return response({ items: [
        { value: "200000", address: { hash: CONTRACT, is_contract: true } },
        { value: "400000", address: { hash: OWNER, is_contract: false } },
        { value: "300000", address: { hash: POOL, is_contract: true } },
      ], next_page_params: { items_count: 3, value: "200000" } });
    }
    return response({
      address_hash: TOKEN.toUpperCase().replace("0X", "0x"),
      decimals: "2",
      total_supply: "1000000",
      holders_count: "14",
      type: "ERC-20",
      symbol: "TEST",
    });
  };
}

test("EVM holder runtime fails closed until its dedicated Blockscout key is configured", () => {
  assert.equal(resolvePublicEvmHolderRuntime({}, "robinhood").state, "disabled");
  assert.equal(resolvePublicEvmHolderRuntime({ RAVENOS_PUBLIC_EVM_HOLDERS_ENABLED: "1" }, "robinhood").state, "misconfigured");
  assert.equal(resolvePublicEvmHolderRuntime(env(), "robinhood").enabled, true);
  assert.equal(resolvePublicEvmHolderRuntime(env(), "avalanche").state, "unsupported");
  assert.deepEqual(OnchainEvmHolderProjectionContract.supported_chains, ["robinhood", "base", "bsc", "ethereum"]);
  assert.equal(OnchainEvmHolderProjectionContract.complete_holder_census_available, false);
  assert.equal(OnchainEvmHolderProjectionContract.maximum_holder_rows, 50);
});

for (const chain of Object.keys(CHAINS)) {
  test(`${chain} holder projection normalizes exact indexed owners without leaking provider credentials`, async () => {
    const projection = await buildPublicEvmHolderProjection({
      env: env(),
      identity: { chain, pool_address: POOL, token_address: TOKEN, quote_token_address: QUOTE },
      fetch_impl: providerFetchFor(chain),
      now: () => new Date("2026-09-01T15:00:00.000Z"),
    });
    assert.equal(projection.schema_version, "ravenos.onchain_holder_list.v2");
    assert.equal(projection.identity.chain, chain);
    assert.equal(projection.identity.token_address, TOKEN);
    assert.equal(projection.coverage.complete_holder_census, false);
    assert.equal(projection.coverage.scope, "provider_ranked_top_holders");
    assert.equal(projection.coverage.maximum_source_accounts, 50);
    assert.equal(projection.coverage.total_owner_rows, 14);
    assert.equal(projection.summary.holder_count, 14);
    assert.equal(projection.summary.top_10_supply_pct, 90);
    assert.equal(projection.summary.largest_non_pool_wallet_supply_pct, 40);
    assert.equal(projection.summary.top_3_wallet_supply_pct, 60);
    assert.equal(projection.summary.top_10_wallet_supply_pct, 60);
    assert.equal(projection.holders.length, 3);
    assert.equal(projection.holders[0].holder_address, OWNER);
    assert.equal(projection.holders[0].balance, "4000");
    assert.equal(projection.holders[1].classification, "exact_pool_account");
    assert.equal(projection.holders[1].excluded_from_wallet_concentration, true);
    assert.equal(projection.holders[2].classification, "contract");
    assert.equal(projection.holders[2].explorer_url, `${CHAINS[chain].explorer}${CONTRACT}`);
    assert.equal(JSON.stringify(projection).includes(API_KEY), false);
    assert.equal(JSON.stringify(projection).includes("api.blockscout.com"), false);
  });
}

test("EVM holder projection rejects provider token identity mismatch", async () => {
  const requestedToken = "0x4444444444444444444444444444444444444444";
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/holders")) return response({ items: [{ value: "1", address: { hash: OWNER, is_contract: false } }] });
    return response({ address_hash: QUOTE, decimals: "18", total_supply: "10", holders_count: "1", type: "ERC-20" });
  };
  await assert.rejects(() => buildPublicEvmHolderProjection({
    env: env(),
    identity: { chain: "robinhood", pool_address: POOL, token_address: requestedToken, quote_token_address: QUOTE },
    fetch_impl: fetchImpl,
  }), (error) => error.code === "holder_provider_identity_mismatch" && error.status === 409);
});

test("Worker resolves an exact Robinhood pool before returning its holder projection", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "api.dexscreener.com" && url.pathname.includes(`/latest/dex/pairs/robinhood/${POOL}`)) {
      return response({ pairs: [{
        chainId: "robinhood",
        dexId: "uniswap",
        pairAddress: POOL,
        baseToken: { address: TOKEN, name: "Test", symbol: "TEST" },
        quoteToken: { address: QUOTE, name: "Wrapped ETH", symbol: "WETH" },
        priceUsd: "2",
        liquidity: { usd: 100_000 },
        volume: { h24: 50_000 },
        txns: { h24: { buys: 20, sells: 15 } },
      }] });
    }
    if (url.hostname === "api.dexpaprika.com") return response({ tokens: [], pools: [] });
    if (url.hostname === "api.blockscout.com") return providerFetchFor("robinhood")(input);
    throw new Error(`unexpected provider request ${url.origin}${url.pathname}`);
  };
  try {
    const result = await worker.fetch(new Request(`https://ravenos.xyz/api/onchain/holders?chain=robinhood&pair_address=${POOL}&token_address=${TOKEN}&quote_address=${QUOTE}`), env());
    const payload = await result.json();
    assert.equal(result.status, 200);
    assert.equal(payload.identity.chain, "robinhood");
    assert.equal(payload.holders.length, 3);
    assert.equal(payload.risk_screen.schema_version, "ravenos.market_control_risk.v1");
    assert.equal(payload.risk_screen.identity.token_address, TOKEN);
    assert.equal(payload.risk_screen.metrics.top_10_wallet_supply_pct, 60);
    assert.equal(payload.risk_screen.measured_facts.find((row) => row.id === "top_10_wallet_concentration")?.source, "Blockscout indexed holders");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Worker reuses one identity-bound Cache API holder response without another provider request", async () => {
  const previousFetch = globalThis.fetch;
  const previousCaches = globalThis.caches;
  const cache = new Map();
  let providerCalls = 0;
  globalThis.caches = {
    default: {
      async match(request) {
        return cache.get(request.url)?.clone() || null;
      },
      async put(request, cachedResponse) {
        cache.set(request.url, cachedResponse.clone());
      },
    },
  };
  globalThis.fetch = async (input) => {
    providerCalls += 1;
    const url = new URL(String(input));
    if (url.hostname === "api.dexscreener.com" && url.pathname.includes(`/latest/dex/pairs/robinhood/${POOL}`)) {
      return response({ pairs: [{
        chainId: "robinhood",
        dexId: "uniswap",
        pairAddress: POOL,
        baseToken: { address: TOKEN, name: "Test", symbol: "TEST" },
        quoteToken: { address: QUOTE, name: "Wrapped ETH", symbol: "WETH" },
        priceUsd: "2",
        liquidity: { usd: 100_000 },
        volume: { h24: 50_000 },
        txns: { h24: { buys: 20, sells: 15 } },
      }] });
    }
    if (url.hostname === "api.dexpaprika.com") return response({ tokens: [], pools: [] });
    if (url.hostname === "api.blockscout.com") return providerFetchFor("robinhood")(input);
    throw new Error(`unexpected provider request ${url.origin}${url.pathname}`);
  };
  const request = () => new Request(`https://ravenos.xyz/api/onchain/holders?chain=robinhood&pair_address=${POOL}&token_address=${TOKEN}&quote_address=${QUOTE}`);
  try {
    const first = await worker.fetch(request(), env());
    const firstPayload = await first.json();
    assert.equal(firstPayload.edge_cache, "miss");
    assert.equal(cache.size, 1);
    const callsAfterFirst = providerCalls;

    const second = await worker.fetch(request(), env());
    const secondPayload = await second.json();
    assert.equal(secondPayload.edge_cache, "hit");
    assert.equal(providerCalls, callsAfterFirst);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  }
});
