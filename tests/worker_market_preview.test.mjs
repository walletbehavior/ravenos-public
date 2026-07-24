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
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
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

test("public trade flags distinguish market preview from disabled customer execution", async () => {
  const response = await worker.fetch(new Request("https://ravenos.xyz/api/trade/flags"), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.market_preview_available, true);
  assert.deepEqual(body.market_preview_markets, ["hyperliquid_perpetual"]);
  assert.equal(body.signing_available, false);
  assert.equal(body.submission_available, false);
  assert.equal(body.flags.RAVENOS_CUSTOMER_TRADE_UI_ENABLE, false);
});
