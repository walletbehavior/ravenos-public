import assert from "node:assert/strict";
import test from "node:test";
import { projectWalletProfileDelivery, walletHoldingsPage, WalletHoldingsDeliveryLimits } from "../lib/customer_trade/wallet_profile_delivery.mjs";

function largeProfile(chain = "solana") {
  const tokens = Array.from({ length: 350 }, (_, index) => ({
    contract: `token-${String(index).padStart(4, "0")}`, mint: `token-${String(index).padStart(4, "0")}`,
    symbol: `Token ${index}`, balance_base_units: "123456789012345678", balance_display: "123456789.012345678",
    provider_mark_value_usd: index % 3 === 0 ? null : index,
    evidence: "retained-observation ".repeat(45),
  }));
  return {
    schema_version: "fixture-profile", source_wallet: { chain, address: "fixture-wallet", network: "mainnet" },
    generated_at: "2026-09-09T20:00:00Z", balances_observed_at: "2026-09-09T19:59:00Z",
    coverage: { normalized_events: 50000 }, source_performance: { realized_pnl_sol: 123.456, closed_lots: 987 },
    ...(chain === "solana" ? {
      holdings_snapshot: { observed_at: "2026-09-09T19:59:00Z", tokens,
        provider_balance_summary: { visible_provider_mark_value_usd: 40833 },
        mark_coverage: { unavailable: tokens.filter(row => row.provider_mark_value_usd === null).map(row => ({ contract: row.contract, reason: "provider_unavailable" })) } },
    } : { positions: { provider_reported_token_balances: tokens }, provider_balance_summary: { visible_provider_mark_value_usd: 40833 } }),
  };
}

for (const chain of ["solana", "robinhood", "base", "bsc", "ethereum"]) {
  test(`${chain} large holdings paginate without erasing stored balances or changing performance`, () => {
    const profile = largeProfile(chain);
    const original = structuredClone(profile);
    assert(Buffer.byteLength(JSON.stringify(profile)) > 256 * 1024);
    const delivered = projectWalletProfileDelivery(profile);
    assert(Buffer.byteLength(JSON.stringify(delivered)) < 128 * 1024);
    assert.deepEqual(delivered.coverage, profile.coverage);
    assert.deepEqual(delivered.source_performance, profile.source_performance);
    const all = [];
    let page = walletHoldingsPage(profile);
    const snapshot = page.pagination.snapshot;
    for (;;) {
      assert(page.tokens.length <= WalletHoldingsDeliveryLimits.rows);
      assert.equal(page.pagination.snapshot, snapshot);
      assert.equal(page.pagination.total, 350);
      assert.equal(page.pagination.observed_at, "2026-09-09T19:59:00Z");
      all.push(...page.tokens);
      if (!page.pagination.has_more) break;
      page = walletHoldingsPage(profile, { cursor: page.pagination.next_cursor });
    }
    assert.equal(all.length, 350);
    assert.equal(new Set(all.map(row => row.contract)).size, 350);
    assert(all[0].provider_mark_value_usd > 300);
    assert.deepEqual(profile, original);
  });
}

test("holdings continuation refuses mixed snapshots and foreign wallet identities", () => {
  const profile = largeProfile();
  const cursor = walletHoldingsPage(profile).pagination.next_cursor;
  const newer = structuredClone(profile);
  newer.holdings_snapshot.tokens[0].balance_base_units = "0";
  assert.throws(() => walletHoldingsPage(newer, { cursor }), /wallet_holdings_snapshot_changed/);
  const other = { ...profile, source_wallet: { ...profile.source_wallet, address: "another-wallet" } };
  assert.throws(() => walletHoldingsPage(other, { cursor }), /wallet_holdings_snapshot_changed/);
  assert.throws(() => walletHoldingsPage(profile, { cursor: "../../../keys" }), /wallet_holdings_cursor_invalid/);
  assert.throws(() => walletHoldingsPage(profile, { cursor: Buffer.from('{"v":1,"offset":-1}').toString('base64url') }), /wallet_holdings_cursor_invalid/);
});

test("balance pages remain stable across a history-only profile update and keep marks with their tokens", () => {
  const profile = largeProfile();
  const page = walletHoldingsPage(profile);
  const historyUpdate = { ...profile, generated_at: "2026-09-09T20:05:00Z", coverage: { normalized_events: 51000 } };
  assert.doesNotThrow(() => walletHoldingsPage(historyUpdate, { cursor: page.pagination.next_cursor }));
  const delivered = projectWalletProfileDelivery(profile);
  assert.deepEqual(delivered.holdings_snapshot.provider_balance_summary, profile.holdings_snapshot.provider_balance_summary);
  assert(delivered.holdings_snapshot.mark_coverage.unavailable.every(row => delivered.holdings_snapshot.tokens.some(token => token.contract === row.contract)));
});
