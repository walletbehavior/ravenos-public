import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker.mjs';

const address = n => `0x${n.toString(16).padStart(40, '0')}`;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('exact pool failures remain retryable on Solana and EVM, including a selected token', async () => {
  const original = globalThis.fetch;
  try {
    for (const [index, chain] of ['solana', 'base', 'ethereum', 'bsc', 'robinhood'].entries()) {
      const pool = chain === 'solana' ? 'GTHKH8s82ZR8GTSFZ1dUu6wfdxhy59wpMShxzG5zjiPm' : address(910 + index);
      const token = chain === 'solana' ? 'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS' : address(920 + index);
      const quote = chain === 'solana' ? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' : address(930 + index);
      let recovered = false;
      globalThis.fetch = async input => {
        if (String(input).includes('api.dexscreener.com')) return recovered
          ? json({ pairs: [{ chainId: chain, pairAddress: pool, baseToken: { address: token, symbol: 'COIN' }, quoteToken: { address: quote, symbol: 'USDC' }, priceUsd: '1.25' }] })
          : json({ error: 'upstream internal detail must not escape' }, 500);
        return json({ pools: [], tokens: [] });
      };
      for (const selected of ['', token]) {
        const query = new URLSearchParams({ chainId: chain, pairAddress: pool, tokenAddress: selected });
        const response = await worker.fetch(new Request(`https://ravenos.xyz/api/dexscreener/pair?${query}`), {});
        assert.equal(response.status, 503, chain);
        assert.equal(response.headers.get('retry-after'), '1');
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const body = await response.json();
        assert.equal(body.ok, false); assert.equal(body.retry_after_ms, 1000);
        assert(!JSON.stringify(body).includes('internal detail'));
      }
      recovered = true;
      const query = new URLSearchParams({ chainId: chain, pairAddress: pool, tokenAddress: token });
      const response = await worker.fetch(new Request(`https://ravenos.xyz/api/dexscreener/pair?${query}`), {});
      const body = await response.json();
      assert.equal(response.status, 200); assert.equal(body.results.length, 1);
      assert.equal(body.results[0].tokenAddress, token); assert.equal(body.results[0].pairAddress, pool);
    }
  } finally { globalThis.fetch = original; }
});

test('a successful empty lookup or wrong pool never becomes a retryable result or a substitute', async () => {
  const original = globalThis.fetch;
  try {
    for (const pairs of [[], [{ chainId: 'base', pairAddress: address(954), baseToken: { address: address(955) }, quoteToken: { address: address(956) } }]]) {
      globalThis.fetch = async input => String(input).includes('api.dexscreener.com') ? json({ pairs }) : json({ pools: [] });
      const query = new URLSearchParams({ chainId: 'base', pairAddress: address(pairs.length ? 957 : 958), tokenAddress: address(955) });
      const response = await worker.fetch(new Request(`https://ravenos.xyz/api/dexscreener/pair?${query}`), {});
      assert.equal(response.status, 200); assert.deepEqual((await response.json()).results, []);
    }
  } finally { globalThis.fetch = original; }
});
