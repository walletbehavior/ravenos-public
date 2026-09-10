import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPublicTokenTradeProjection } from '../lib/onchain_trade_projection.mjs';
import { observedMarketWallets } from '../lib/customer_trade/market_wallet_index.mjs';
import { observedWalletMarketEvidence } from '../lib/customer_trade/wallet_market_evidence.mjs';
import worker from '../worker.mjs';

const address = n => '0x' + n.toString(16).padStart(40, '0');
const tx = n => '0x' + n.toString(16).padStart(64, '0');
const NOW = Date.parse('2026-09-10T01:30:00Z');
const trade = (i = 1) => ({ provider_trade_id: `${tx(i)}-${i}`, transaction_hash: tx(i),
  trader_address: address(5), side: i === 1 ? 'buy' : 'sell', token_amount: 10,
  quote_amount: 0.001, price_usd: 2, volume_usd: 20, observed_at: new Date(NOW - i * 1000).toISOString() });
const envelope = (chain = 'bsc') => ({ ok: true, schema_version: 'ravenos.provider_trades.dexch.v1', chain,
  token_address: address(2), provenance: { retrieved_at: new Date(NOW).toISOString() }, rows: [trade(1), trade(2)] });

test('token activity exposes bounded traders and transactions without claiming exact-pool evidence', () => {
  const value = buildPublicTokenTradeProjection(envelope(), { chain: 'bsc', token_address: address(2), now: NOW });
  assert.equal(value.schema_version, 'ravenos.onchain_token_trades.v1');
  assert.equal(value.trades.length, 2);
  assert.equal(value.summary.windows.m5.net_buy_volume_usd, 0);
  assert.equal(value.active_traders[0].recurrence, 'repeat');
  assert.equal(value.identity.pool_address, undefined);
  assert.equal(value.identity.quote_token_address, undefined);
  assert.equal(value.trades[0].quote_amount, null, 'provider does not identify the quote denomination');
  assert.equal(value.coverage.exact_pool_verified, false);
  assert.equal(value.execution_boundary.submission_available, false);
  assert.equal(value.source.attribution_url, 'https://dexch.art');
  assert.deepEqual(observedMarketWallets(value, { now: NOW / 1000 }), []);
  assert.deepEqual(observedWalletMarketEvidence(value, { now: NOW / 1000 }), []);
});

test('token activity rejects mismatched identities, stale envelopes and malformed events', () => {
  for (const override of [{ chain: 'base' }, { token_address: address(3) }, { schema_version: 'other' }, { ok: false },
    { provenance: { retrieved_at: new Date(NOW - 121000).toISOString() } }]) {
    assert.throws(() => buildPublicTokenTradeProjection({ ...envelope(), ...override }, { chain: 'bsc', token_address: address(2), now: NOW }));
  }
  const rows = [trade(), trade(), { ...trade(3), transaction_hash: 'bad' }, { ...trade(4), volume_usd: -1 },
    { ...trade(5), observed_at: new Date(NOW + 600000).toISOString() }, { ...trade(6), side: 'transfer' }];
  assert.equal(buildPublicTokenTradeProjection({ ...envelope(), rows }, { chain: 'bsc', token_address: address(2), now: NOW }).trades.length, 1);
});

test('public Worker serves live-shaped Dexch token activity with CoinGecko off, caches reads and respects disable', async () => {
  const original = globalThis.fetch, calls = [];
  const env = { RAVENOS_COINGECKO_ENABLED: '0', RAVENOS_MARKET_PROVIDER_FALLBACKS_ENABLED: '1',
    RAVENOS_DEXCH_DISCOVERY_ENABLED: '1', RAVENOS_DEXCH_COMMERCIAL_USE_ACKNOWLEDGED: '1' };
  globalThis.fetch = async input => {
    const url = new URL(String(input)); calls.push(url);
    assert.equal(url.hostname, 'api.dexch.art');
    const chain = url.pathname.split('/')[4];
    return new Response(JSON.stringify({ data: [
      { id: tx(1) + '-1', chain, tokenAddress: address(2), txHash: tx(1), trader: address(5), side: 'buy', amountToken: 10,
        amountQuote: 0.001, priceUsd: 2, volumeUsd: 20, timestamp: new Date(Date.now() - 1000).toISOString() },
      { id: tx(2) + '-2', chain: chain === 'bsc' ? 'robinhood' : 'bsc', tokenAddress: address(2), txHash: tx(2), trader: address(5), side: 'buy', amountToken: 10,
        amountQuote: 0.001, priceUsd: 2, volumeUsd: 20, timestamp: new Date().toISOString() },
    ] }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    for (const chain of ['bsc', 'robinhood']) {
      const request = () => new Request('https://ravenos.xyz/api/onchain/trades?' + new URLSearchParams({ chain,
        pair_address: address(1), token_address: address(2), quote_address: address(3) }));
      for (let i = 0; i < 2; i++) {
        const response = await worker.fetch(request(), env), body = await response.json();
        assert.equal(response.status, 200); assert.equal(body.ok, true, JSON.stringify(body));
        assert.equal(body.trades.length, 1, 'cross-chain provider row is dropped');
        assert.equal(body.identity.chain, chain); assert.equal(body.identity.pool_address, undefined);
      }
      const disabled = await worker.fetch(request(), { ...env, RAVENOS_MARKET_PROVIDER_FALLBACKS_ENABLED: '0' });
      assert.equal((await disabled.json()).ok, false, 'a cached token feed cannot bypass disable');
    }
    assert.equal(calls.length, 2);
    const invalid = await worker.fetch(new Request('https://ravenos.xyz/api/onchain/trades?chain=bsc&pair_address=bad&token_address=bad&quote_address=bad'), env);
    assert.equal(invalid.status, 400); assert.equal(calls.length, 2);
    const unsupported = await worker.fetch(new Request('https://ravenos.xyz/api/onchain/trades?' + new URLSearchParams({ chain: 'base', pair_address: address(1), token_address: address(2), quote_address: address(3) })), env);
    assert.equal((await unsupported.json()).ok, false); assert.equal(calls.length, 2);
  } finally { globalThis.fetch = original; }
});
