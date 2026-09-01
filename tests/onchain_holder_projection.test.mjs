import assert from "node:assert/strict";
import test from "node:test";
import bs58 from "bs58";

import {
  ONCHAIN_HOLDER_SCHEMA,
  OnchainHolderProjectionContract,
  buildPublicSolanaHolderProjection,
  measurePublicSolanaOwnerHolding,
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
const FULL_POOL = "11111111111111111111111111111111";
const INDEXED_POOL = "Config1111111111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

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

function programAccount(pubkey, owner, amount, mint = TOKEN) {
  const bytes = Buffer.alloc(72);
  Buffer.from(bs58.decode(mint)).copy(bytes, 0);
  Buffer.from(bs58.decode(owner)).copy(bytes, 32);
  bytes.writeBigUInt64LE(BigInt(amount), 64);
  return { pubkey, account: { owner: TOKEN_PROGRAM, data: [bytes.toString("base64"), "base64"] } };
}

function mintAccountData({ mintAuthority = false, freezeAuthority = false } = {}) {
  const bytes = Buffer.alloc(82);
  bytes.writeUInt32LE(mintAuthority ? 1 : 0, 0);
  bytes.writeUInt32LE(freezeAuthority ? 1 : 0, 46);
  return [bytes.toString("base64"), "base64"];
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
  assert.equal(OnchainHolderProjectionContract.maximum_holder_rows, 100);
  assert.equal(OnchainHolderProjectionContract.maximum_census_source_accounts, 25_000);
  assert.equal(OnchainHolderProjectionContract.indexed_token_account_page_size, 1_000);
  assert.equal(OnchainHolderProjectionContract.complete_holder_census_available, true);
});

test("indexed exact-mint token accounts are the primary bounded Solana holder census", async () => {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    assert.equal(String(input), "https://solana-display.invalid/rpc");
    const request = JSON.parse(init.body);
    calls.push(request);
    if (request.method === "getAccountInfo") {
      return response({ jsonrpc: "2.0", id: 1, result: { context: { slot: 100 }, value: { owner: TOKEN_PROGRAM, data: mintAccountData() } } });
    }
    if (request.method === "getTokenSupply") {
      return response({ jsonrpc: "2.0", id: 1, result: { context: { slot: 101 }, value: { amount: "1000", decimals: 0, uiAmountString: "1000" } } });
    }
    if (request.method === "getTokenAccounts") {
      assert.equal(request.params.mintAddress, TOKEN);
      assert.equal(request.params.limit, 1_000);
      assert.deepEqual(request.params.options, { showZeroBalance: false });
      if (!request.params.cursor) {
        return response({ jsonrpc: "2.0", id: 1, result: {
          total: 3,
          limit: 1_000,
          cursor: "cursor-two",
          last_indexed_slot: 102,
          token_accounts: [programAccount(ACCOUNT_A, OWNER_A, 400), programAccount(ACCOUNT_B, OWNER_A, 300)],
        } });
      }
      assert.equal(request.params.cursor, "cursor-two");
      return response({ jsonrpc: "2.0", id: 1, result: {
        total: 3,
        limit: 1_000,
        cursor: null,
        last_indexed_slot: 103,
        token_accounts: [programAccount(ACCOUNT_C, INDEXED_POOL, 200)],
      } });
    }
    throw new Error(`unexpected rpc method ${request.method}`);
  };

  const projection = await buildPublicSolanaHolderProjection({
    env: holderEnv(),
    identity: { chain: "solana", pool_address: INDEXED_POOL, token_address: TOKEN, quote_token_address: QUOTE },
    fetch_impl: fetchImpl,
    now: () => new Date("2026-09-01T22:00:00.000Z"),
  });
  assert.equal(projection.coverage.complete_holder_census, true);
  assert.equal(projection.coverage.page_count, 2);
  assert.equal(projection.coverage.scanned_source_accounts, 3);
  assert.equal(projection.summary.holder_count, 2);
  assert.equal(projection.holders[0].holder_address, OWNER_A);
  assert.equal(projection.holders[0].balance, "700");
  assert.equal(projection.holders[1].classification, "exact_pool_account");
  assert.equal(projection.source.method, "indexed_token_accounts");
  assert.equal(calls.some((call) => call.method === "getProgramAccounts"), false);
  assert.equal(calls.some((call) => call.method === "getTokenLargestAccounts"), false);
  assert.equal(JSON.stringify(projection).includes("cursor-two"), false);
});

test("indexed holder identity contradictions fail closed instead of dropping to a substitute scan", async () => {
  const fetchImpl = async (_input, init = {}) => {
    const request = JSON.parse(init.body);
    if (request.method === "getAccountInfo") {
      return response({ jsonrpc: "2.0", id: 1, result: { context: { slot: 110 }, value: { owner: TOKEN_PROGRAM, data: mintAccountData() } } });
    }
    if (request.method === "getTokenSupply") {
      return response({ jsonrpc: "2.0", id: 1, result: { context: { slot: 111 }, value: { amount: "1000", decimals: 0, uiAmountString: "1000" } } });
    }
    if (request.method === "getTokenAccounts") {
      return response({ jsonrpc: "2.0", id: 1, result: {
        total: 1,
        cursor: null,
        last_indexed_slot: 112,
        token_accounts: [programAccount(ACCOUNT_A, OWNER_A, 400, QUOTE)],
      } });
    }
    throw new Error(`unexpected fallback ${request.method}`);
  };

  await assert.rejects(() => buildPublicSolanaHolderProjection({
    env: holderEnv(),
    identity: { chain: "solana", pool_address: "SysvarS1otHashes111111111111111111111111111", token_address: TOKEN, quote_token_address: QUOTE },
    fetch_impl: fetchImpl,
  }), (error) => error.code === "holder_rpc_identity_mismatch" && error.status === 409);
});

test("indexed holder projection completes provider pagination and aggregates every nonzero account by owner", async () => {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    assert.equal(String(input), "https://solana-display.invalid/rpc");
    const request = JSON.parse(init.body);
    calls.push(request);
    if (request.method === "getAccountInfo") {
      return response({ jsonrpc: "2.0", id: 1, result: { context: { slot: 80 }, value: { owner: TOKEN_PROGRAM, data: mintAccountData() } } });
    }
    if (request.method === "getTokenSupply") {
      return response({ jsonrpc: "2.0", id: 1, result: { context: { slot: 81 }, value: { amount: "1000", decimals: 0, uiAmountString: "1000" } } });
    }
    if (request.method === "getProgramAccounts") {
      assert.equal(request.params[0], TOKEN_PROGRAM);
      assert.deepEqual(request.params[1].filters, [{ memcmp: { offset: 0, bytes: TOKEN } }]);
      assert.deepEqual(request.params[1].dataSlice, { offset: 0, length: 72 });
      if (!request.params[1].pageKey) {
        return response({ jsonrpc: "2.0", id: 1, result: {
          context: { slot: 82 },
          value: [programAccount(ACCOUNT_A, OWNER_A, 400), programAccount(ACCOUNT_B, OWNER_A, 300)],
          pageKey: "page-two",
        } });
      }
      assert.equal(request.params[1].pageKey, "page-two");
      return response({ jsonrpc: "2.0", id: 1, result: {
        context: { slot: 83 },
        value: [programAccount(ACCOUNT_C, FULL_POOL, 200)],
      } });
    }
    throw new Error(`unexpected rpc method ${request.method}`);
  };

  const projection = await buildPublicSolanaHolderProjection({
    env: holderEnv(),
    identity: { chain: "solana", pool_address: FULL_POOL, token_address: TOKEN, quote_token_address: QUOTE },
    fetch_impl: fetchImpl,
    now: () => new Date("2026-08-27T16:00:00.000Z"),
  });
  assert.equal(projection.schema_version, ONCHAIN_HOLDER_SCHEMA);
  assert.equal(projection.coverage.complete_holder_census, true);
  assert.equal(projection.coverage.scope, "all_nonzero_token_accounts");
  assert.equal(projection.coverage.scanned_source_accounts, 3);
  assert.equal(projection.coverage.total_owner_rows, 2);
  assert.equal(projection.coverage.page_count, 2);
  assert.equal(projection.summary.holder_count, 2);
  assert.equal(projection.summary.token_account_count, 3);
  assert.equal(projection.summary.top_10_supply_pct, 90);
  assert.equal(projection.summary.largest_non_pool_wallet_supply_pct, 70);
  assert.equal(projection.summary.top_3_wallet_supply_pct, 70);
  assert.equal(projection.summary.top_10_wallet_supply_pct, 70);
  assert.equal(projection.token_controls.mint_authority, "disabled");
  assert.equal(projection.token_controls.freeze_authority, "disabled");
  assert.equal(projection.holders.length, 2);
  assert.equal(projection.holders[0].holder_address, OWNER_A);
  assert.equal(projection.holders[0].balance, "700");
  assert.equal(projection.holders[0].token_account_count, 2);
  assert.equal(projection.holders[1].classification, "exact_pool_account");
  assert.equal(calls.some((call) => call.method === "getTokenLargestAccounts"), false);
  assert.equal(JSON.stringify(projection).includes("page-two"), false);
  assert.equal(JSON.stringify(projection).includes("solana-display.invalid"), false);
});

test("developer holdings are independently measured from the exact owner and mint", async () => {
  const fetchImpl = async (input, init = {}) => {
    assert.equal(String(input), "https://solana-display.invalid/rpc");
    const request = JSON.parse(init.body);
    if (request.method === "getTokenSupply") {
      return response({ jsonrpc: "2.0", id: 1, result: { context: { slot: 91 }, value: { amount: "1000", decimals: 0, uiAmountString: "1000" } } });
    }
    if (request.method === "getTokenAccountsByOwner") {
      assert.equal(request.params[0], OWNER_A);
      assert.deepEqual(request.params[1], { mint: TOKEN });
      const parsed = (amount) => ({
        pubkey: ACCOUNT_A,
        account: { data: { program: "spl-token", parsed: { info: { mint: TOKEN, owner: OWNER_A, tokenAmount: { amount, decimals: 0 } } } } },
      });
      return response({ jsonrpc: "2.0", id: 1, result: { context: { slot: 92 }, value: [parsed("70")] } });
    }
    throw new Error(`unexpected rpc method ${request.method}`);
  };
  const result = await measurePublicSolanaOwnerHolding({
    env: holderEnv(),
    identity: { chain: "solana", pool_address: POOL, token_address: TOKEN, quote_token_address: QUOTE },
    owner_address: OWNER_A,
    fetch_impl: fetchImpl,
    now: () => new Date("2026-08-27T16:00:00.000Z"),
  });
  assert.equal(result.schema_version, "ravenos.solana_owner_holding.v1");
  assert.equal(result.supply_share_pct, 7);
  assert.equal(result.balance, "70");
  assert.equal(result.owner_address, OWNER_A);
  assert.equal(JSON.stringify(result).includes("solana-display.invalid"), false);
});

test("free holder projection truthfully falls back to the largest accounts when an indexed scan is unavailable", async () => {
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
  assert.equal(projection.coverage.scan_state, "unavailable");
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
  assert.equal(projection.summary.largest_non_pool_wallet_supply_pct, 70);
  assert.equal(projection.summary.top_3_wallet_supply_pct, 70);
  assert.equal(projection.summary.top_10_wallet_supply_pct, 70);
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
    assert.equal(holderPayload.risk_screen.schema_version, "ravenos.market_control_risk.v1");
    assert.equal(holderPayload.risk_screen.identity.pool_address, POOL);
    assert.equal(holderPayload.risk_screen.metrics.top_10_wallet_supply_pct, 70);
    assert.equal(holderPayload.risk_screen.interpretation.scam_or_rug_determination, false);
    assert.equal(holderPayload.risk_screen.interpretation.numeric_probability, false);
    assert.match(holders.headers.get("cache-control"), /s-maxage=180/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
