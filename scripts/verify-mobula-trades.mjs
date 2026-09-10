// Three public exact-pool reads, then cached repeats. No wallet permission or
// execution endpoint; this qualifies the deployed Worker transport, not fills.
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';

const origin = new URL(process.argv[2] || 'https://app.ravenos.xyz');
assert(origin.protocol === 'https:' && (['app.ravenos.xyz','ravenos.xyz'].includes(origin.hostname)
  || /^[a-z0-9-]+\.crowbar346\.workers\.dev$/.test(origin.hostname)), 'unsupported verification origin');
const markets = [
  { chain:'solana', pair_address:'6HfaJiUuTXFZEfmdkQSNbvfe6i95Nh2wUVJ5dWMf7gtw', token_address:'zGh48JtNHVBb5evgoZLXwgPD2Qu4MhkWdJLGDAupump', quote_address:'So11111111111111111111111111111111111111112' },
  { chain:'base', pair_address:'0x4e962bb3889bf030368f56810a9c96b83cb3e778', token_address:'0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', quote_address:'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
  { chain:'ethereum', pair_address:'0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640', token_address:'0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', quote_address:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
];
const evidence = [];
for (const market of markets) {
  const url = new URL('/api/onchain/trades?'+new URLSearchParams(market),origin);
  const started = Date.now();
  const response = await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(15000)});
  const body = await response.json();
  assert.equal(response.status,200);assert.equal(body.ok,true,`${market.chain}: ${body.error || body.state}`);
  assert.equal(body.source.label,'Mobula');assert.equal(body.source.attribution_url,'https://mobula.io');
  assert.equal(body.identity.chain,market.chain);assert.equal(body.identity.pool_address,market.pair_address);
  assert.equal(body.identity.token_address,market.token_address);assert.equal(body.identity.quote_token_address,market.quote_address);
  assert.equal(body.coverage.exact_pool_verified,true);assert.equal(body.execution_boundary.submission_available,false);
  assert(body.trades.length>0 && body.trades.length<=120);
  assert(body.trades.every(row=>row.token_amount>0 && row.quote_amount>0 && row.price_usd>0 && row.volume_usd>0
    && ['buy','sell'].includes(row.side) && typeof row.transaction_explorer_url==='string'));
  const repeated = await (await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(15000)})).json();
  assert.equal(repeated.observed_at,body.observed_at,'repeat must reuse the same durable observation');
  assert.deepEqual(repeated.trades,body.trades);
  evidence.push({chain:market.chain,pool:market.pair_address,rows:body.trades.length,wallets:body.active_traders.length,
    observed_at:body.observed_at,latest_trade_at:body.freshness.latest_trade_at,elapsed_ms:Date.now()-started,cached_repeat:true});
  await pause(1600);
}
console.log(JSON.stringify({ok:true,origin:origin.origin,checked_at:new Date().toISOString(),transactions_submitted:0,evidence},null,2));
