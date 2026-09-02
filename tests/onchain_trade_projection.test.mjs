import assert from "node:assert/strict";
import test from "node:test";

import {
  ONCHAIN_TRADE_SCHEMA,
  OnchainTradeProjectionContract,
  buildPublicOnchainTradeProjection,
} from "../lib/onchain_trade_projection.mjs";
import worker from "../worker.mjs";

const POOL = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const QUOTE = "0x3333333333333333333333333333333333333333";
const TRADER_A = "0x4444444444444444444444444444444444444444";
const TRADER_B = "0x5555555555555555555555555555555555555555";
const TX_A = `0x${"a".repeat(64)}`;
const TX_B = `0x${"b".repeat(64)}`;
const TX_C = `0x${"c".repeat(64)}`;
const NOW = new Date("2026-08-28T12:00:00.000Z");
const ROBINHOOD_V4_POOL = "0x0646357e2ed21b9964f09616152fda33433965b58c830e8d52b8f31b3b616102";

function providerTrade({ id, hash, trader, at, side, volume, amount = 1_000 } = {}) {
  const buy = side === "buy";
  return {
    id,
    type: "trade",
    attributes: {
      block_number: 42,
      tx_hash: hash,
      tx_from_address: trader,
      from_token_amount: buy ? String(volume) : String(amount),
      to_token_amount: buy ? String(amount) : String(volume),
      price_from_in_usd: buy ? "1" : String(volume / amount),
      price_to_in_usd: buy ? String(volume / amount) : "1",
      block_timestamp: at,
      kind: side,
      volume_in_usd: String(volume),
      from_token_address: buy ? QUOTE : TOKEN,
      to_token_address: buy ? TOKEN : QUOTE,
    },
  };
}

function payload(base = NOW) {
  const baseMs = base instanceof Date ? base.getTime() : Date.parse(String(base));
  return { data: [
    providerTrade({ id: "base_trade_a", hash: TX_A, trader: TRADER_A, at: new Date(baseMs - 30_000).toISOString(), side: "buy", volume: 4_000 }),
    providerTrade({ id: "base_trade_b", hash: TX_B, trader: TRADER_A, at: new Date(baseMs - 120_000).toISOString(), side: "sell", volume: 1_000 }),
    providerTrade({ id: "base_trade_c", hash: TX_C, trader: TRADER_B, at: new Date(baseMs - 40 * 60_000).toISOString(), side: "buy", volume: 500 }),
  ] };
}

test("exact-pool trade projection exposes a bounded tape and honest recurrence without private joins", () => {
  const projection = buildPublicOnchainTradeProjection({
    identity: { chain: "base", pool_address: POOL, token_address: TOKEN, quote_token_address: QUOTE },
    provider_payload: payload(),
    observed_at: NOW.toISOString(),
    now: () => NOW,
  });
  assert.equal(projection.schema_version, ONCHAIN_TRADE_SCHEMA);
  assert.equal(projection.ok, true);
  assert.equal(projection.identity.instrument_id, `base:pool:${POOL}`);
  assert.equal(projection.trades.length, 3);
  assert.equal(projection.trades[0].side, "buy");
  assert.equal(projection.trades[0].price_usd, 4);
  assert.equal(projection.trades[0].trader_address, TRADER_A);
  assert.equal(projection.trades[0].transaction_explorer_url, `https://basescan.org/tx/${TX_A}`);
  assert.equal(projection.summary.windows.m5.trade_count, 2);
  assert.equal(projection.summary.windows.m5.net_buy_volume_usd, 3_000);
  assert.equal(projection.summary.windows.h1.unique_trader_count, 2);
  assert.equal(projection.summary.repeat_trader_count, 1);
  assert.equal(projection.active_traders[0].trader_address, TRADER_A);
  assert.equal(projection.active_traders[0].recurrence, "repeat");
  assert.equal(projection.active_traders[0].direction, "buy_dominant");
  assert.equal(projection.privacy.customer_account_joined, false);
  assert.equal(projection.execution_boundary.submission_available, false);
  assert.equal(OnchainTradeProjectionContract.actor_labels_inferred, false);
});

test("trade projection drops wrong-token, future, malformed-address, and duplicate provider rows", () => {
  const malformed = payload();
  malformed.data.push(malformed.data[0]);
  malformed.data.push(providerTrade({ id: "future", hash: `0x${"d".repeat(64)}`, trader: TRADER_B, at: "2026-08-28T12:20:00.000Z", side: "buy", volume: 900 }));
  malformed.data.push({
    ...providerTrade({ id: "wrong-pair", hash: `0x${"e".repeat(64)}`, trader: TRADER_B, at: "2026-08-28T11:50:00.000Z", side: "buy", volume: 900 }),
    attributes: {
      ...providerTrade({ id: "wrong-pair", hash: `0x${"e".repeat(64)}`, trader: TRADER_B, at: "2026-08-28T11:50:00.000Z", side: "buy", volume: 900 }).attributes,
      to_token_address: "0x6666666666666666666666666666666666666666",
    },
  });
  const projection = buildPublicOnchainTradeProjection({
    identity: { chain: "base", pool_address: POOL, token_address: TOKEN, quote_token_address: QUOTE },
    provider_payload: malformed,
    now: () => NOW,
  });
  assert.equal(projection.trades.length, 3);
  assert.equal(JSON.stringify(projection).includes("wrong-pair"), false);
  assert.equal(JSON.stringify(projection).includes("future"), false);
});

test("Robinhood v4 accepts a bytes32 exact-pool ID without widening token or trader addresses", () => {
  const robinhoodPayload = payload();
  const projection = buildPublicOnchainTradeProjection({
    identity: {
      chain: "robinhood",
      pool_address: ROBINHOOD_V4_POOL,
      token_address: TOKEN,
      quote_token_address: QUOTE,
    },
    provider_payload: robinhoodPayload,
    now: () => NOW,
  });

  assert.equal(projection.ok, true);
  assert.equal(projection.identity.pool_address, ROBINHOOD_V4_POOL);
  assert.equal(projection.identity.instrument_id, `robinhood:pool:${ROBINHOOD_V4_POOL}`);
  assert.equal(projection.trades.length, 3);
  assert.equal(projection.trades[0].trader_address, TRADER_A);
  assert.equal(projection.trades[0].transaction_explorer_url, `https://robinhoodchain.blockscout.com/tx/${TX_A}`);
  assert.equal(OnchainTradeProjectionContract.evm_pool_identity, "20_byte_address_or_32_byte_pool_id");
  assert.equal(OnchainTradeProjectionContract.evm_token_and_actor_identity, "20_byte_address_only");

  assert.throws(() => buildPublicOnchainTradeProjection({
    identity: {
      chain: "robinhood",
      pool_address: ROBINHOOD_V4_POOL,
      token_address: ROBINHOOD_V4_POOL,
      quote_token_address: QUOTE,
    },
    provider_payload: robinhoodPayload,
    now: () => NOW,
  }), /onchain_trade_identity_invalid/);

  const malformedTraderPayload = payload();
  malformedTraderPayload.data[0].attributes.tx_from_address = ROBINHOOD_V4_POOL;
  const malformedTraderProjection = buildPublicOnchainTradeProjection({
    identity: {
      chain: "robinhood",
      pool_address: ROBINHOOD_V4_POOL,
      token_address: TOKEN,
      quote_token_address: QUOTE,
    },
    provider_payload: malformedTraderPayload,
    now: () => NOW,
  });
  assert.equal(malformedTraderProjection.trades[0].trader_address, null);
});

test("Worker trade route verifies exact CoinGecko pool identity and never returns raw provider fields", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, headers: init.headers || {} });
    if (url.includes(`/networks/base/pools/${POOL}?include=`)) {
      return new Response(JSON.stringify({
        data: {
          id: `base_${POOL}`,
          type: "pool",
          attributes: { address: POOL },
          relationships: {
            base_token: { data: { id: `base_${TOKEN}` } },
            quote_token: { data: { id: `base_${QUOTE}` } },
          },
        },
        included: [
          { id: `base_${TOKEN}`, type: "token", attributes: { address: TOKEN, decimals: 18 } },
          { id: `base_${QUOTE}`, type: "token", attributes: { address: QUOTE, decimals: 6 } },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes(`/networks/base/pools/${POOL}/trades?token=base`)) {
      return new Response(JSON.stringify(payload(new Date())), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected request ${url}`);
  };
  try {
    const response = await worker.fetch(new Request(`https://ravenos.xyz/api/onchain/trades?chain=base&pair_address=${POOL}&token_address=${TOKEN}&quote_address=${QUOTE}`), {
      ONCHAIN_CHART_PROVIDER: "coingecko",
      ONCHAIN_CHART_PROVIDER_PLAN: "basic",
      ONCHAIN_CHART_PROVIDER_COMMERCIAL: "true",
      ONCHAIN_CHART_PROVIDER_SECRET: "server-only-test-key",
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.schema_version, ONCHAIN_TRADE_SCHEMA);
    assert.equal(body.identity.pool_address, POOL);
    assert.equal(body.trades.length, 3);
    assert.equal(body.active_traders[0].trade_count, 2);
    assert.match(response.headers.get("cache-control"), /s-maxage=5/);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].headers["x-cg-pro-api-key"], "server-only-test-key");
    assert.equal(JSON.stringify(body).includes("x-cg-pro-api-key"), false);
    assert.equal(JSON.stringify(body).includes("attributes"), false);

    const invalid = await worker.fetch(new Request(`https://ravenos.xyz/api/onchain/trades?chain=base&pair_address=${POOL}&token_address=${TOKEN}&quote_address=${QUOTE}&limit=9999`), {});
    assert.equal(invalid.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Worker trade route preserves a Robinhood v4 bytes32 exact-pool identity", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes(`/networks/robinhood/pools/${ROBINHOOD_V4_POOL}?include=`)) {
      return new Response(JSON.stringify({
        data: {
          id: `robinhood_${ROBINHOOD_V4_POOL}`,
          type: "pool",
          attributes: { address: ROBINHOOD_V4_POOL },
          relationships: {
            base_token: { data: { id: `robinhood_${TOKEN}` } },
            quote_token: { data: { id: `robinhood_${QUOTE}` } },
          },
        },
        included: [
          { id: `robinhood_${TOKEN}`, type: "token", attributes: { address: TOKEN, decimals: 18 } },
          { id: `robinhood_${QUOTE}`, type: "token", attributes: { address: QUOTE, decimals: 18 } },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes(`/networks/robinhood/pools/${ROBINHOOD_V4_POOL}/trades?token=base`)) {
      return new Response(JSON.stringify(payload(new Date())), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected request ${url}`);
  };
  try {
    const response = await worker.fetch(new Request(`https://ravenos.xyz/api/onchain/trades?chain=robinhood&pair_address=${ROBINHOOD_V4_POOL}&token_address=${TOKEN}&quote_address=${QUOTE}`), {
      ONCHAIN_CHART_PROVIDER: "coingecko",
      ONCHAIN_CHART_PROVIDER_PLAN: "basic",
      ONCHAIN_CHART_PROVIDER_COMMERCIAL: "true",
      ONCHAIN_CHART_PROVIDER_SECRET: "server-only-test-key",
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.identity.pool_address, ROBINHOOD_V4_POOL);
    assert.equal(body.trades.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
