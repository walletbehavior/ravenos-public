import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker.mjs';

test('pasted pool hashes reach providers intact and cannot select a same-prefix contract', async () => {
  const pool = '0x' + 'ab'.repeat(32), contract = pool.slice(0, 42), calls = [], originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input));calls.push(url);
    if (url.hostname === 'api.dexscreener.com') return Response.json({ pairs: [pool, contract].map(pairAddress => ({
      chainId: 'robinhood', pairAddress, dexId: 'uniswap',
      baseToken: { address: '0x' + '12'.repeat(20), symbol: 'TEST' },
      quoteToken: { address: '0x' + '34'.repeat(20), symbol: 'WETH' },
      liquidity: { usd: 100000 }, priceUsd: '1', volume: { h24: 10000 },
    })) });
    if (url.hostname === 'api.dexpaprika.com') return Response.json({ pools: [] });
    throw new Error('Unexpected provider');
  };
  try {
    const query = 'https://dexscreener.com/robinhood/' + pool;
    const response = await worker.fetch(new Request('https://ravenos.xyz/api/dexscreener/search?q=' + encodeURIComponent(query)), {});
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.results.map(row => row.pairAddress), [pool]);
    assert.equal(body.results[0].input_match, 'pool_address');
    assert.equal(calls.length, 2);
    assert(calls.every(url => (url.searchParams.get('q') || url.searchParams.get('query')) === pool));
  } finally { globalThis.fetch = originalFetch; }
});
