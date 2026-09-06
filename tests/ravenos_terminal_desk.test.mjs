import assert from "node:assert/strict";
import test from "node:test";
import { deskMarket, deskPreferences } from "../ravenos-terminal-desk.js";

test("saved desk markets retain exact identity and discard account or execution data", () => {
  for (const chain of ["robinhood", "base", "bsc", "ethereum"]) {
    const row = deskMarket({ lane: "spot", chain, label: "TOKEN/USDC", pool: "0x" + "AB".repeat(32), token: "0x" + "CD".repeat(20), quote: "0x" + "EF".repeat(20), wallet: "private", amount: 100, signedTransaction: "private", href: "https://other.example" });
    assert.equal(row.pool, "0x" + "ab".repeat(32));
    assert.equal(row.token, "0x" + "cd".repeat(20));
    assert.deepEqual(Object.keys(row).sort(), ["chain", "key", "label", "lane", "pool", "quote", "token"]);
    assert.equal(deskMarket({ ...row, quote: "invalid" }), null);
    assert.equal(deskMarket({ ...row, token: row.pool }), null);
  }
  assert.equal(deskMarket({ lane: "equity", instrumentId: "etf:nyse-arca:spy", asset: "SPY", label: "SPY" }).key, "etf:nyse-arca:spy");
  assert.equal(deskMarket({ lane: "equity", instrumentId: "https://example.com", asset: "SPY", label: "SPY" }), null);
  const row = deskMarket({ lane: "spot", chain: "solana", label: "SOL/USDC", pool: "So11111111111111111111111111111111111111112", token: "So11111111111111111111111111111111111111112", quote: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" });
  assert.equal(row.pool, "So11111111111111111111111111111111111111112");
  assert.equal(deskMarket({ ...row, chain: "unknown" }), null);
  assert.equal(deskMarket({ lane: "perps", asset: "javascript:alert(1)", label: "Bad" }), null);
});

test("malformed or excessive saved workspace preferences fall back to bounded defaults", () => {
  assert.deepEqual(deskPreferences(null), { layout: "balanced", rail: true, pinned: [], markets: [], dataHeight: 300 });
  const markets = Array.from({ length: 30 }, (_, i) => ({ lane: "perps", asset: `TOKEN${i}-PERP`, label: `Token ${i}` }));
  const prefs = deskPreferences({ markets: [null, markets[0], ...markets], layout: "injected", dataHeight: 999999, account: "secret" });
  assert.equal(prefs.markets.length, 20);
  assert.equal(new Set(prefs.markets.map(row => row.key)).size, 20);
  assert.equal(prefs.layout, "balanced");
  assert.equal(prefs.dataHeight, 600);
  assert.equal(prefs.account, undefined);
  assert.equal(deskPreferences({ dataHeight: -10 }).dataHeight, 180);
});
