import assert from "node:assert/strict";
import test from "node:test";

import worker from "../worker.mjs";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Worker returns an exact live-book Hyperliquid market preview without an execution payload", async () => {
  const previousFetch = globalThis.fetch;
  const observedAt = Date.now() - 500;
  const providerCalls = [];
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(String(init.body || "{}"));
    providerCalls.push(body.type);
    if (body.type === "metaAndAssetCtxs") {
      return jsonResponse([
        { universe: [{ name: "PREVIEW", maxLeverage: 10 }] },
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
    if (body.type === "l2Book") {
      return jsonResponse({
        coin: "PREVIEW",
        time: observedAt,
        levels: [
          [
            { px: "99.9", sz: "20", n: 5 },
            { px: "99.8", sz: "20", n: 4 },
          ],
          [
            { px: "100.1", sz: "20", n: 5 },
            { px: "100.2", sz: "20", n: 4 },
          ],
        ],
      });
    }
    if (body.type === "recentTrades") return jsonResponse([]);
    return jsonResponse({}, 404);
  };

  try {
    const response = await worker.fetch(new Request("https://ravenos.xyz/api/trade/market-preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        instrument_id: "hyperliquid:perp:PREVIEW",
        side: "long",
        notional_usdc: 500,
        leverage: 5,
        max_impact_bps: 100,
      }),
    }), {});
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(body.ok, true);
    assert.equal(body.schema_version, "ravenos.hyperliquid_market_preview.v1");
    assert.equal(body.instrument.instrument_id, "hyperliquid:perp:PREVIEW");
    assert.equal(body.intent.estimated_initial_margin_usdc, 100);
    assert.equal(body.route.consumed_book_side, "asks");
    assert.equal(body.execution_boundary.prepared_order_available, false);
    assert.equal(body.execution_boundary.signing_available, false);
    assert.equal(body.execution_boundary.submission_available, false);
    assert.deepEqual(new Set(providerCalls), new Set(["metaAndAssetCtxs", "l2Book", "recentTrades"]));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Worker refuses a non-exact market preview before provider access", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("provider_should_not_be_called");
  };
  try {
    const response = await worker.fetch(new Request("https://ravenos.xyz/api/trade/market-preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        instrument_id: "BTC",
        side: "long",
        notional_usdc: 500,
        leverage: 2,
      }),
    }), {});
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.unavailable_reason, "exact_instrument_identity_mismatch");
    assert.equal(body.execution_boundary.signing_available, false);
    assert.equal(body.execution_boundary.submission_available, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Worker returns an exact Hyperliquid limit plan with no prepared payload", async () => {
  const previousFetch = globalThis.fetch;
  const observedAt = Date.now() - 500;
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(String(init.body || "{}"));
    if (body.type === "metaAndAssetCtxs") {
      return jsonResponse([
        { universe: [{ name: "PREVIEW", maxLeverage: 10 }] },
        [{ funding: "0.00001", openInterest: "1000", dayNtlVlm: "2500000", markPx: "100", midPx: "100", oraclePx: "99.98", prevDayPx: "98" }],
      ]);
    }
    if (body.type === "l2Book") {
      return jsonResponse({
        coin: "PREVIEW",
        time: observedAt,
        levels: [
          [{ px: "99.9", sz: "20", n: 5 }, { px: "99.8", sz: "20", n: 4 }],
          [{ px: "100.1", sz: "20", n: 5 }, { px: "100.2", sz: "20", n: 4 }],
        ],
      });
    }
    if (body.type === "recentTrades") return jsonResponse([]);
    return jsonResponse({}, 404);
  };

  try {
    const response = await worker.fetch(new Request("https://ravenos.xyz/api/trade/order-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        instrument_id: "hyperliquid:perp:PREVIEW",
        side: "long",
        order_type: "limit",
        notional_usdc: 500,
        leverage: 5,
        limit_price: 99,
        time_in_force: "gtc",
        take_profit_price: 105,
        stop_loss_price: 96,
      }),
    }), {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.schema_version, "ravenos.hyperliquid_order_plan.v1");
    assert.equal(body.intent.order_type, "limit");
    assert.equal(body.entry_model.state, "resting_limit");
    assert.equal(body.risk_bracket.configured, true);
    assert.equal(body.review.prepared_payload_included, false);
    assert.equal(body.execution_boundary.signing_available, false);
    assert.equal(body.execution_boundary.submission_available, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Worker returns a bounded public Hyperliquid account snapshot without venue identifiers", async () => {
  const previousFetch = globalThis.fetch;
  const providerCalls = [];
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(String(init.body || "{}"));
    providerCalls.push(body.type);
    if (body.type === "clearinghouseState") {
      return jsonResponse({
        marginSummary: { accountValue: "4200", totalNtlPos: "1800", totalRawUsd: "2400", totalMarginUsed: "360" },
        crossMarginSummary: { accountValue: "4200", totalMarginUsed: "360" },
        withdrawable: "2040",
        assetPositions: [{ position: { coin: "SOL", szi: "12", entryPx: "145", positionValue: "1800", unrealizedPnl: "60", returnOnEquity: "0.1667", liquidationPx: "95", marginUsed: "360", leverage: { type: "cross", value: 5 }, cumFunding: { sinceOpen: "-1.2", sinceChange: "-0.2", allTime: "-4.5" } } }],
      });
    }
    if (body.type === "spotClearinghouseState") return jsonResponse({ balances: [{ coin: "USDC", total: "50", hold: "5", entryNtl: "50", token: 0 }] });
    if (body.type === "frontendOpenOrders") return jsonResponse([{ coin: "SOL", side: "A", sz: "4", origSz: "4", limitPx: "160", orderType: "Limit", tif: "Gtc", reduceOnly: true, timestamp: Date.now(), oid: 12345 }]);
    if (body.type === "userFills") return jsonResponse([{ coin: "SOL", side: "B", sz: "12", px: "145", dir: "Open Long", closedPnl: "0", fee: "0.4", feeToken: "USDC", crossed: true, time: Date.now(), hash: "0xprivatehash", oid: 12345, tid: 67890 }]);
    return jsonResponse({}, 404);
  };

  try {
    const response = await worker.fetch(new Request("https://ravenos.xyz/api/trade/account-snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
    }), {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.schema_version, "ravenos.hyperliquid_account_snapshot.v1");
    assert.equal(body.summary.account_value_usdc, 4200);
    assert.equal(body.positions.length, 1);
    assert.equal(body.balances[0].available, 45);
    assert.equal(body.open_orders[0].reduce_only, true);
    assert.equal(body.fills.length, 1);
    assert.equal(body.account.ownership_asserted, false);
    assert.equal(body.account.persisted, false);
    assert.equal(body.execution_boundary.signing_available, false);
    assert.equal(body.execution_boundary.submission_available, false);
    assert.deepEqual(new Set(providerCalls), new Set(["clearinghouseState", "spotClearinghouseState", "frontendOpenOrders", "userFills"]));
    assert.doesNotMatch(JSON.stringify(body), /privatehash|12345|67890|"hash"|"oid"|"tid"/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Worker returns an account-informed Hyperliquid order scenario with current fees and no execution payload", async () => {
  const previousFetch = globalThis.fetch;
  const observedAt = Date.now() - 300;
  const providerCalls = [];
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(String(init.body || "{}"));
    providerCalls.push(body.type);
    if (body.type === "metaAndAssetCtxs") {
      return jsonResponse([
        { universe: [{ name: "SCENARIO", maxLeverage: 20 }] },
        [{ funding: "0.00001", openInterest: "1000", dayNtlVlm: "2500000", markPx: "100", midPx: "100", oraclePx: "99.98", prevDayPx: "98" }],
      ]);
    }
    if (body.type === "l2Book") {
      return jsonResponse({
        coin: "SCENARIO",
        time: observedAt,
        levels: [
          [{ px: "99.9", sz: "50", n: 5 }],
          [{ px: "100.1", sz: "50", n: 5 }],
        ],
      });
    }
    if (body.type === "recentTrades") return jsonResponse([]);
    if (body.type === "clearinghouseState") {
      return jsonResponse({
        marginSummary: { accountValue: "5000", totalNtlPos: "0", totalRawUsd: "5000", totalMarginUsed: "0" },
        crossMarginSummary: { accountValue: "5000", totalMarginUsed: "0" },
        crossMaintenanceMarginUsed: "0",
        withdrawable: "2500",
        assetPositions: [],
      });
    }
    if (body.type === "spotClearinghouseState") return jsonResponse({ balances: [] });
    if (body.type === "frontendOpenOrders" || body.type === "userFills") return jsonResponse([]);
    if (body.type === "userFees") return jsonResponse({ userCrossRate: "0.0004", userAddRate: "0.0001" });
    return jsonResponse({}, 404);
  };

  try {
    const response = await worker.fetch(new Request("https://ravenos.xyz/api/trade/account-scenario", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address: "0xdddddddddddddddddddddddddddddddddddddddd",
        instrument_id: "hyperliquid:perp:SCENARIO",
        side: "long",
        order_type: "market",
        notional_usdc: 1000,
        leverage: 5,
        margin_mode: "cross",
        reduce_only: false,
        max_impact_bps: 100,
      }),
    }), {});
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(body.ok, true);
    assert.equal(body.schema_version, "ravenos.hyperliquid_account_scenario.v1");
    assert.equal(body.position_effect.effect, "open");
    assert.equal(body.fee_estimate.estimated_entry_fee_usdc, 0.4);
    assert.equal(body.margin_check.state, "passes_current_snapshot");
    assert.equal(body.execution_boundary.prepared_order_available, false);
    assert.equal(body.execution_boundary.signing_available, false);
    assert.equal(body.execution_boundary.submission_available, false);
    assert.deepEqual(new Set(providerCalls), new Set([
      "metaAndAssetCtxs",
      "l2Book",
      "recentTrades",
      "clearinghouseState",
      "spotClearinghouseState",
      "frontendOpenOrders",
      "userFills",
      "userFees",
    ]));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Worker returns bounded public Hyperliquid order history without provider order ids", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(String(init.body || "{}"));
    if (body.type === "historicalOrders") return jsonResponse([{
      order: { coin: "SOL", side: "A", origSz: "10", sz: "0", limitPx: "155", orderType: "Limit", tif: "Gtc", oid: 91234 },
      status: "filled",
      statusTimestamp: Date.now(),
    }]);
    return jsonResponse({}, 404);
  };
  try {
    const response = await worker.fetch(new Request("https://ravenos.xyz/api/trade/account-history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", kind: "orders" }),
    }), {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.schema_version, "ravenos.hyperliquid_account_history.v1");
    assert.equal(body.orders[0].status, "filled");
    assert.equal(body.orders[0].filled_size, 10);
    assert.doesNotMatch(JSON.stringify(body), /91234|"oid"/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Worker rejects an invalid Hyperliquid account address before provider access", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("provider_should_not_be_called");
  };
  try {
    const response = await worker.fetch(new Request("https://ravenos.xyz/api/trade/account-snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: "0x1234" }),
    }), {});
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, "invalid_hyperliquid_address");
    assert.equal(body.signing_available, false);
    assert.equal(body.submission_available, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("public trade flags distinguish market preview from disabled customer execution", async () => {
  const response = await worker.fetch(new Request("https://ravenos.xyz/api/trade/flags"), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.market_preview_available, true);
  assert.deepEqual(body.market_preview_markets, ["hyperliquid_perpetual"]);
  assert.equal(body.order_plan_available, true);
  assert.deepEqual(body.order_plan_types, ["market", "limit", "trigger"]);
  assert.equal(body.public_account_view_available, true);
  assert.deepEqual(body.public_account_view_venues, ["hyperliquid"]);
  assert.equal(body.browser_wallet_connection_available, true);
  assert.equal(body.wallet_connection_scope, "public_address_observation_only");
  assert.equal(body.wallet_signature_requested, false);
  assert.equal(body.wallet_connection_persisted, false);
  assert.equal(body.account_scenario_available, true);
  assert.deepEqual(body.account_scenario_venues, ["hyperliquid"]);
  assert.equal(body.account_history_available, true);
  assert.deepEqual(body.account_history_types, ["orders"]);
  assert.equal(body.signing_available, false);
  assert.equal(body.submission_available, false);
  assert.deepEqual(body.spot_quote_preview_chains, []);
  assert.equal(body.trade_adapter_states.hyperliquid, "quote_review");
  assert.equal(body.trade_adapter_states.base, "adapter_pending");
  assert.equal(body.flags.RAVENOS_CUSTOMER_TRADE_UI_ENABLE, false);
});

test("Worker proves a same-chain Solana USDC entry and reverse USDC exit without transaction material", async () => {
  const previousFetch = globalThis.fetch;
  const pool = "11111111111111111111111111111111";
  const token = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6pB2XP1WKY3Mo9f";
  const quote = "So11111111111111111111111111111111111111112";
  const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const providerCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url);
    providerCalls.push(`${url.hostname}${url.pathname}`);
    if (url.hostname === "api.dexscreener.com") {
      return jsonResponse({
        pairs: [{
          chainId: "solana",
          dexId: "raydium",
          pairAddress: pool,
          baseToken: { address: token, symbol: "BONK", name: "Bonk" },
          quoteToken: { address: quote, symbol: "SOL", name: "Wrapped SOL" },
          priceUsd: "0.00002",
          liquidity: { usd: 10_000_000 },
          volume: { h24: 25_000_000 },
          txns: { h24: { buys: 1000, sells: 900 } },
          priceChange: { h24: 5 },
        }],
      });
    }
    if (url.hostname.includes("dexpaprika")) return jsonResponse({ tokens: [], pools: [] });
    if (url.hostname === "solana-display.invalid") {
      const rpc = JSON.parse(String(init.body || "{}"));
      if (rpc.method === "getTokenSupply") return jsonResponse({ jsonrpc: "2.0", id: rpc.id, result: { value: { amount: "100000000000000", decimals: 5 } } });
      return jsonResponse({ jsonrpc: "2.0", id: rpc.id, result: { value: [] } });
    }
    if (url.hostname === "api.jup.ag") {
      const reverse = url.searchParams.get("inputMint") === token;
      const now = new Date();
      const inputMint = reverse ? token : usdc;
      const outputMint = reverse ? usdc : token;
      return jsonResponse({
        quoteId: reverse ? "reverse-proof" : "entry-proof",
        inputMint,
        outputMint,
        inAmount: url.searchParams.get("amount"),
        outAmount: reverse ? "487610000" : "100000000000",
        otherAmountThreshold: reverse ? "480000000" : "99000000000",
        priceImpactPct: reverse ? "0.007" : "0.006",
        quoteTimestamp: now.toISOString(),
        expireAt: new Date(now.getTime() + 20_000).toISOString(),
        routePlan: [{ swapInfo: { inputMint, outputMint, label: "Raydium" } }],
      });
    }
    return jsonResponse({}, 404);
  };

  try {
    const response = await worker.fetch(new Request("https://ravenos.xyz/api/trade/spot-quote-preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schema_version: "ravenos.universal_shadow_quote_request.v1",
        instrument_id: `solana:pool:${pool}`,
        identity_scope: "exact_pool",
        chain: "solana",
        pool_address: pool,
        token_address: token,
        quote_address: quote,
        side: "buy",
        display_amount: "500",
        sell_percent: null,
        wallet_address: null,
        slippage_bps: 50,
        priority: { mode: "standard", maximum_lamports: null, jito: false },
        plan: { source: "custom", take_profit_price: null, stop_loss_price: null, authorizes_transaction: false },
      }),
    }), {
      RAVENOS_PUBLIC_SOLANA_HOLDERS_ENABLED: "1",
      RAVENOS_PUBLIC_SOLANA_HOLDERS_RPC_URL: "https://solana-display.invalid/rpc",
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(body.intent.economic_flow, "canonical_usdc_to_selected_token");
    assert.equal(body.intent.input_mint, usdc);
    assert.equal(body.intent.output_mint, token);
    assert.equal(body.shadow_execution.mode, "shadow");
    assert.equal(body.shadow_execution.route_state, "exit_verified");
    assert.equal(body.shadow_execution.round_trip.exit_verified, true);
    assert.equal(body.shadow_execution.round_trip.current_executable_liquidation_usdc, 487.61);
    assert.equal(body.shadow_execution.round_trip.round_trip_friction_pct, null);
    assert.equal(body.shadow_execution.round_trip.trade_available, false);
    assert.equal(body.shadow_execution.execution.signing_available, false);
    assert.equal(body.shadow_execution.execution.submission_available, false);
    assert.equal(body.shadow_execution.execution.transaction_material_available, false);
    assert.equal(body.fee_policy.free_fee_bps, 255);
    assert.equal(body.fee_policy.pro_fee_bps, 178);
    assert.equal(body.fee_policy.actual_fee_bps, 0);
    assert.doesNotMatch(JSON.stringify(body), /serializedTransaction|swapTransaction|privateKey|secretKey/);
    assert.equal(providerCalls.filter((row) => row === "api.jup.ag/swap/v2/order").length, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
