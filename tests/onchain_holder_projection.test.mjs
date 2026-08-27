import assert from "node:assert/strict";
import test from "node:test";

import {
  ONCHAIN_HOLDER_SCHEMA,
  OnchainHolderProjectionContract,
  buildPublicSolanaHolderProjection,
  resolvePublicSolanaHolderRuntime,
} from "../lib/onchain_holder_projection.mjs";
import worker from "../worker.mjs";

const POOL = "3w7NMJECsezNurAb3MbvTiEtVeayhqNXgXXcqiK5qwwj";
const TOKEN = "EBLUKPgx5FvTUBU6bTJi3aR8XVELSBdC5FiodSWQpump";
const QUOTE = "So11111111111111111111111111111111111111112";
const ACCOUNT_A = "SysvarRent111111111111111111111111111111111";
const ACCOUNT_B = "SysvarC1ock11111111111111111111111111111111";
const ACCOUNT_C = "Vote111111111111111111111111111111111111111";
const OWNER_A = "Stake11111111111111111111111111111111111111";

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function rpcFetch(input, init = {}) {
  const url = String(input);
  assert.equal(url, "https://solana-display.invalid/rpc");
  const request = JSON.parse(init.body);
  if (request.method === "getTokenLargestAccounts") {
    assert.equal(request.params[0], TOKEN);
    return response({ jsonrpc: "2.0", id: 1, result: { context: { slot: 42 }, value: [
      { address: ACCOUNT_A, amount: "400", decimals: 0, uiAmountString: "400" },
      { address: ACCOUNT_B, amount: "300", decimals: 0, uiAmountString: "300" },
      { address: ACCOUNT_C, amount: "200", decimals: 0, uiAmountString: "200" },
    ] } });
  }
  if (request.method === "getTokenSupply") {
    assert.equal(request.params[0], TOKEN);
    return response({ jsonrpc: "2.0", id: 1, result: { context: { slot: 41 }, value: { amount: "1000", decimals: 0, uiAmountString: "1000" } } });
  }
  if (request.method === "getMultipleAccounts") {
    assert.deepEqual(request.params[0], [ACCOUNT_A, ACCOUNT_B, ACCOUNT_C]);
    const parsed = (owner, amount) => ({ data: { program: "spl-token", parsed: { info: { mint: TOKEN, owner, tokenAmount: { amount, decimals: 0, uiAmountString: amount } }, type: "account" }, space: 165 } });
    return response({ jsonrpc: "2.0", id: 1, result: { context: { slot: 43 }, value: [parsed(OWNER_A, "400"), parsed(OWNER_A, "300"), parsed(POOL, "200")] } });
  }
  throw new Error(`unexpected rpc method ${request.method}`);
}

function holderEnv() {
  return {
    RAVENOS_PUBLIC_SOLANA_HOLDERS_ENABLED: "1",
    RAVENOS_PUBLIC_SOLANA_HOLDERS_RPC_URL: "https://solana-display.invalid/rpc",
  };
}

test("public holder runtime is separately activated and never falls back to a private RPC", () => {
  assert.deepEqual(resolvePublicSolanaHolderRuntime({}), {
    enabled: false,
    state: "disabled",
    rpc_url: null,
    source_label: "Solana on-chain accounts",
  });
  assert.equal(resolvePublicSolanaHolderRuntime({
    RAVENOS_PUBLIC_SOLANA_HOLDERS_ENABLED: "1",
    RAVENOS_SOLANA_RPC_URL: "https://private-raven.invalid/rpc",
  }).state, "misconfigured");
  assert.equal(resolvePublicSolanaHolderRuntime({
    RAVENOS_PUBLIC_SOLANA_HOLDERS_ENABLED: "1",
    RAVENOS_PUBLIC_SOLANA_HOLDERS_RPC_URL: "http://127.0.0.1:8899",
  }).enabled, false);
  assert.equal(OnchainHolderProjectionContract.public_by_default, true);
  assert.equal(OnchainHolderProjectionContract.private_rpc_fallback_allowed, false);
});

test("free holder projection returns actual owner rows with exact supply shares and pool exclusions", async () => {
  const projection = await buildPublicSolanaHolderProjection({
    env: holderEnv(),
    identity: { chain: "solana", pool_address: POOL, token_address: TOKEN, quote_token_address: QUOTE },
    fetch_impl: rpcFetch,
    now: () => new Date("2026-08-27T16:00:00.000Z"),
  });
  assert.equal(projection.schema_version, ONCHAIN_HOLDER_SCHEMA);
  assert.equal(projection.safe_public, true);
  assert.equal(projection.coverage.complete_holder_census, false);
  assert.equal(projection.coverage.maximum_source_accounts, 20);
  assert.equal(projection.holders.length, 2);
  assert.deepEqual(projection.holders[0], {
    rank: 1,
    holder_address: OWNER_A,
    token_account_address: ACCOUNT_A,
    token_account_count: 2,
    balance: "700",
    supply_share_pct: 70,
    classification: "owner",
    excluded_from_wallet_concentration: false,
    explorer_url: `https://solscan.io/account/${OWNER_A}`,
  });
  assert.equal(projection.holders[1].classification, "exact_pool_account");
  assert.equal(projection.holders[1].excluded_from_wallet_concentration, true);
  assert.equal(JSON.stringify(projection).includes("solana-display.invalid"), false);
  assert.equal(JSON.stringify(projection).includes("getTokenLargestAccounts"), false);
});

test("a Solana pool address Raven emits resolves back to the same BITCAT exact market", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes(`/latest/dex/pairs/solana/${POOL}`)) {
      return response({ pairs: [{
        chainId: "solana",
        dexId: "pumpswap",
        pairAddress: POOL,
        baseToken: { address: TOKEN, name: "bitcat", symbol: "BITCAT" },
        quoteToken: { address: QUOTE, name: "Wrapped SOL", symbol: "SOL" },
        priceUsd: "0.0005663",
        liquidity: { usd: 64_600 },
        volume: { h24: 208_000 },
        txns: { h24: { buys: 820, sells: 713 } },
      }] });
    }
    if (url.includes("api.dexscreener.com") || url.includes("api.dexpaprika.com")) return response({ pairs: [], tokens: [], pools: [] });
    throw new Error(`unexpected provider request ${url} ${init.method || "GET"}`);
  };
  try {
    const request = new Request(`https://ravenos.xyz/api/dexscreener/search?q=${POOL}`, { headers: { accept: "application/json" } });
    const result = await worker.fetch(request, {});
    const payload = await result.json();
    assert.equal(result.status, 200);
    assert.equal(payload.results.length, 1);
    assert.equal(payload.results[0].input_match, "pool_address");
    assert.equal(payload.results[0].pairAddress, POOL);
    assert.equal(payload.results[0].tokenAddress, TOKEN);
    assert.equal(payload.results[0].quoteTokenAddress, QUOTE);
    assert.equal(payload.results[0].symbol, "BITCAT");

    const holders = await worker.fetch(new Request(`https://ravenos.xyz/api/onchain/holders?chain=solana&pair_address=${POOL}&token_address=${TOKEN}&quote_address=${QUOTE}`, {
      headers: { accept: "application/json" },
    }), holderEnv());
    const holderPayload = await holders.json();
    assert.equal(holders.status, 200);
    assert.equal(holderPayload.schema_version, ONCHAIN_HOLDER_SCHEMA);
    assert.equal(holderPayload.identity.pool_address, POOL);
    assert.equal(holderPayload.holders.length, 2);
    assert.match(holders.headers.get("cache-control"), /s-maxage=60/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
