import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeHyperliquidBook,
  normalizeHyperliquidCoin,
  normalizeHyperliquidTrades,
} from "../lib/hyperliquid_market.mjs";

test("Hyperliquid coin validation preserves exact supported identity", () => {
  assert.equal(normalizeHyperliquidCoin("btc-perp"), "BTC");
  assert.equal(normalizeHyperliquidCoin("xyz:XYZ100"), "XYZ:XYZ100");
  assert.equal(normalizeHyperliquidCoin("../../secret"), null);
});

test("book normalization exposes bounded levels and transparent observed summaries", () => {
  const book = normalizeHyperliquidBook({
    coin: "BTC",
    time: Date.parse("2026-07-21T10:00:00Z"),
    levels: [
      [{ px: "99", sz: "2", n: 3 }],
      [{ px: "101", sz: "1", n: 2 }],
    ],
  });
  assert.equal(book.coin, "BTC");
  assert.equal(book.summary.mid_price, 100);
  assert.equal(book.summary.spread_bps, 200);
  assert.equal(book.bids[0].notional_usd, 198);
  assert.equal(book.asks[0].notional_usd, 101);
});

test("trade normalization strips users, hashes, and provider trade ids", () => {
  const tape = normalizeHyperliquidTrades([{
    coin: "BTC",
    side: "A",
    px: "100",
    sz: "2",
    time: Date.parse("2026-07-21T10:00:00Z"),
    hash: "0xprivate-transaction-hash",
    tid: 123,
    users: ["0xprivate-buyer", "0xprivate-seller"],
  }]);
  assert.equal(tape.trades[0].book_side, "ask");
  assert.equal(tape.trades[0].notional_usd, 200);
  assert.equal(JSON.stringify(tape).includes("0xprivate"), false);
  assert.equal("hash" in tape.trades[0], false);
  assert.equal("users" in tape.trades[0], false);
  assert.deepEqual(tape.privacy, {
    participant_addresses_removed: true,
    transaction_hashes_removed: true,
    provider_trade_ids_removed: true,
  });
});
