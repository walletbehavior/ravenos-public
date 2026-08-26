import assert from "node:assert/strict";
import test from "node:test";

import {
  createHyperliquidAccountSnapshot,
  normalizeHyperliquidAddress,
} from "../lib/customer_trade/hyperliquid_account_snapshot.mjs";

const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

test("Hyperliquid account snapshots expose useful public state without venue identifiers", () => {
  const snapshot = createHyperliquidAccountSnapshot({
    address: ADDRESS.toUpperCase().replace("0X", "0x"),
    clearinghouse: {
      marginSummary: { accountValue: "12500.25", totalNtlPos: "8100", totalRawUsd: "4400.25", totalMarginUsed: "1620" },
      crossMarginSummary: { accountValue: "12500.25", totalMarginUsed: "1620" },
      crossMaintenanceMarginUsed: "405",
      withdrawable: "2780.25",
      assetPositions: [{
        position: {
          coin: "SOL",
          szi: "42.5",
          entryPx: "142.25",
          positionValue: "6081.75",
          unrealizedPnl: "36.125",
          returnOnEquity: "0.0223",
          liquidationPx: "112.5",
          marginUsed: "1216.35",
          leverage: { type: "cross", value: 5 },
          maxLeverage: 20,
          cumFunding: { sinceOpen: "-2.25", sinceChange: "-0.75", allTime: "-9.5" },
        },
      }],
    },
    openOrders: [{
      coin: "SOL",
      side: "A",
      sz: "10",
      origSz: "25",
      limitPx: "155",
      orderType: "Limit",
      tif: "Gtc",
      reduceOnly: true,
      timestamp: 1_788_000_000_000,
      oid: 998877,
      cloid: "0xprivate-provider-id",
    }],
    fills: [{
      coin: "SOL",
      side: "B",
      sz: "3.5",
      px: "142.2",
      dir: "Open Long",
      closedPnl: "0",
      crossed: true,
      fee: "0.21",
      feeToken: "USDC",
      time: 1_788_000_001_000,
      oid: 998877,
      tid: 778899,
      hash: "0xnot-public-in-raven",
    }],
  }, { observedAt: "2026-08-26T12:00:00.000Z" });

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.state, "observed");
  assert.equal(snapshot.account.address, ADDRESS);
  assert.equal(snapshot.account.ownership_asserted, false);
  assert.equal(snapshot.account.persisted, false);
  assert.equal(snapshot.summary.account_value_usdc, 12500.25);
  assert.equal(snapshot.positions[0].side, "long");
  assert.equal(snapshot.positions[0].funding.since_open_usdc, -2.25);
  assert.equal(snapshot.open_orders[0].reduce_only, true);
  assert.equal(snapshot.fills[0].liquidity, "taker");
  assert.equal(snapshot.fills[0].fee_asset, "USDC");
  assert.equal(snapshot.execution_boundary.signing_available, false);
  assert.equal(snapshot.execution_boundary.submission_available, false);
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /not-public-in-raven|998877|778899|private-provider-id/);
  assert.doesNotMatch(serialized, /"hash"|"oid"|"tid"|"cloid"/);
});

test("Hyperliquid account snapshots represent a truly empty public address without invented rows", () => {
  const snapshot = createHyperliquidAccountSnapshot({
    address: ADDRESS,
    clearinghouse: {
      marginSummary: { accountValue: "0", totalNtlPos: "0", totalRawUsd: "0", totalMarginUsed: "0" },
      withdrawable: "0",
      assetPositions: [],
    },
    openOrders: [],
    fills: [],
  });
  assert.equal(snapshot.state, "empty");
  assert.deepEqual(snapshot.positions, []);
  assert.deepEqual(snapshot.open_orders, []);
  assert.deepEqual(snapshot.fills, []);
});

test("Hyperliquid address normalization fails closed", () => {
  assert.equal(normalizeHyperliquidAddress(ADDRESS.toUpperCase().replace("0X", "0x")), ADDRESS);
  assert.equal(normalizeHyperliquidAddress("0x1234"), null);
  assert.throws(() => createHyperliquidAccountSnapshot({ address: "not-an-address" }), /invalid_hyperliquid_address/);
});
