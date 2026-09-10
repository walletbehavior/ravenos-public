import assert from 'node:assert/strict';
import test from 'node:test';
import { MarketProviderReader, MarketProviderPolicy, normalizeDexScreenerActivity, dexchWalletCandidates } from '../lib/market_provider_fallbacks.mjs';
import { DexchDiscoveryProvider } from '../lib/dexch_discovery_provider.mjs';

const NOW = Date.parse('2026-09-09T12:00:00Z');
const address = n => '0x' + n.toString(16).padStart(40, '0');
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const pair = (overrides = {}) => ({ chainId: 'base', pairAddress: address(1), baseToken: { address: address(2), symbol: 'TOKEN' }, quoteToken: { address: address(3), symbol: 'WETH' },
  priceUsd: '2.50', liquidity: { usd: 125000 }, volume: { m5: 8000 }, txns: { m5: { buys: 5, sells: 3 } }, priceChange: { m5: 2 }, pairCreatedAt: NOW - 86400000, ...overrides });
const token = chain => ({ chain, address: address(2), name: 'Token', symbol: 'TOKEN', priceUsd: 2, liquidityUsd: 10000 });

test('a provider cooldown survives a cold reader without blocking separately limited discovery', async () => {
  const rows = new Map(); let now = NOW, calls = 0;
  const cache = { match: async key => rows.get(key.url)?.clone(), put: async (key, response) => rows.set(key.url, response) };
  const options = { now: () => now, cache: () => cache, fetchFn: async url => {
    calls++;
    return url.includes('/tokens/v1/') && now < NOW + 120000 ? new Response('', { status: 429, headers: { 'retry-after': '120' } }) : json({ ok: true });
  } };
  await assert.rejects(new MarketProviderReader(options).read('https://api.dexscreener.com/tokens/v1/base/0xaaa'), /429/);
  now += 45000;
  await assert.rejects(new MarketProviderReader(options).read('https://api.dexscreener.com/latest/dex/pairs/ethereum/0xbbb'), error => error.code === 'market_provider_backoff' && error.retry_after_ms === 75000);
  assert.equal(calls, 1);
  assert.equal((await new MarketProviderReader(options).read('https://api.dexscreener.com/token-profiles/latest/v1')).ok, true);
  now = NOW + 120001;
  assert.equal((await new MarketProviderReader(options).read('https://api.dexscreener.com/tokens/v1/base/0xaaa')).ok, true);
  assert.equal(calls, 3);
});

test('cache failures cannot clear an existing provider cooldown', async () => {
  let calls = 0;
  const reader = new MarketProviderReader({ now: () => NOW,
    cache: () => ({ match: async () => { throw new Error('cache unavailable'); }, put: async () => { throw new Error('cache unavailable'); } }),
    fetchFn: async () => { calls++; return new Response('', { status: 429 }); },
  });
  await assert.rejects(reader.read('https://api.dexscreener.com/tokens/v1/base/0xaaa'), /429/);
  await assert.rejects(reader.read('https://api.dexscreener.com/latest/dex/pairs/base/0xbbb'), error => error.code === 'market_provider_backoff' && error.retry_after_ms === 60000);
  assert.equal(calls, 1);
});

test('shared provider reads coalesce, preserve observation time, and refresh expired snapshots', async () => {
  let now = NOW, calls = 0;
  const reader = new MarketProviderReader({ now: () => now, cache: () => null, fetchFn: async (_, init) => { calls++; assert.equal(init.redirect, 'manual'); return json({ value: calls }); } });
  const url = 'https://api.dexscreener.com/latest/dex/search?q=WETH';
  const [a,b] = await Promise.all([reader.snapshot(url), reader.snapshot(url)]);
  assert.equal(calls, 1); assert.deepEqual(a,b);
  now += 20000;
  const cached = await reader.snapshot(url);
  assert.equal(cached.cache_hit, true); assert.equal(cached.observed_at, a.observed_at);
  now += 10001;
  assert.equal((await reader.read(url)).value, 2); assert.equal(calls, 2);
});

test('public provider memory is bounded by bytes as market batches grow', () => {
  const reader = new MarketProviderReader();
  for (let i = 0; i < 30; i++) reader.remember(String(i), { value: { data: 'x'.repeat(1024 * 1024) } });
  assert(reader.memoryBytes <= MarketProviderPolicy.cache_bytes);
  assert(reader.memory.size < 30);
  assert(reader.memory.has('29'));
  const before = reader.memoryBytes;
  reader.remember('29', { value: { data: 'small replacement' } });
  assert(reader.memoryBytes < before, 'replacing an entry releases its prior byte reservation');
});

test('public cache serves another isolate but never stores authorization or API keys', async () => {
  const rows = new Map(); let calls = 0;
  const cache = { match: async key => rows.get(key.url)?.clone(), put: async (key,res) => rows.set(key.url,res) };
  const options = { now: () => NOW, cache: () => cache, fetchFn: async () => { calls++; return json({ rows: [1] }); } };
  const url = 'https://api.dexscreener.com/token-profiles/latest/v1';
  await new MarketProviderReader(options).read(url);
  assert.deepEqual(await new MarketProviderReader(options).read(url), { rows: [1] }); assert.equal(calls, 1);
  for (const key of ['first-secret','second-secret']) await new MarketProviderReader(options).read('https://pro-api.coingecko.com/api/v3/onchain/networks/base/pools', { headers: new Headers({ 'x-cg-pro-api-key': key }) });
  assert.equal(calls, 3); assert.equal(rows.size, 1);
  assert(!JSON.stringify([...rows.keys()]).includes('secret'));
});

test('quota exhaustion backs off other requests to the same provider while alternatives continue', async () => {
  let now = NOW, calls = 0;
  const reader = new MarketProviderReader({ now: () => now, cache: () => null, fetchFn: async url => { calls++; return url.includes('coingecko') ? json({ status: { error_code: 10006 } },429) : json({ ok: true }); } });
  await assert.rejects(reader.read('https://pro-api.coingecko.com/api/v3/onchain/networks/base/pools'), /429/);
  await assert.rejects(reader.read('https://pro-api.coingecko.com/api/v3/onchain/networks/eth/pools'), /backoff/);
  assert.equal(calls, 1);
  assert.equal((await reader.read('https://api.dexscreener.com/latest/dex/search?q=ETH')).ok, true);
  now += MarketProviderPolicy.quota_retry_ms + 1;
  await assert.rejects(reader.read('https://pro-api.coingecko.com/api/v3/onchain/networks/base/pools'), /429/);
  assert.equal(calls, 3);
});

test('optional discovery rate limits do not disable market prices; market limits still cover every market endpoint', async () => {
  let calls = 0, marketFails = false;
  const reader = new MarketProviderReader({ now: () => NOW, cache: () => null, fetchFn: async url => {
    calls++;
    return /\/metas\//.test(url) || marketFails ? json({}, 429) : json({ ok: true });
  } });
  await assert.rejects(reader.read('https://api.dexscreener.com/metas/trending/v1'), /429/);
  await assert.rejects(reader.read('https://api.dexscreener.com/token-profiles/latest/v1'), /backoff/);
  assert.equal((await reader.read('https://api.dexscreener.com/latest/dex/search?q=ETH')).ok, true);
  marketFails = true;
  await assert.rejects(reader.read('https://api.dexscreener.com/tokens/v1/base/0xabc'), /429/);
  await assert.rejects(reader.read('https://api.dexscreener.com/latest/dex/pairs/base/0xdef'), error => {
    assert.equal(error.code, 'market_provider_backoff');
    assert.equal(error.provider_failure_code, 'market_provider_http_429');
    assert.equal(error.retry_after_ms, 60000);
    return true;
  });
  await assert.rejects(reader.read('https://api.dexscreener.com/token-pairs/v1/base/0xabc'), /backoff/);
  assert.equal(calls, 3);
});

test('provider Retry-After seconds and dates suppress early market retries and preserve the cause', async () => {
  for (const retryAfter of ['120', new Date(NOW + 120000).toUTCString()]) {
    let now = NOW, calls = 0;
    const reader = new MarketProviderReader({ now: () => now, cache: () => null, fetchFn: async () => {
      calls++;
      return calls === 1 ? new Response('', { status: 429, headers: { 'retry-after': retryAfter } }) : json({ ok: true });
    } });
    await assert.rejects(reader.read('https://api.dexscreener.com/tokens/v1/base/0xabc'), error => error.code === 'market_provider_http_429' && error.retry_after_ms === 120000);
    now += 61000;
    await assert.rejects(reader.read('https://api.dexscreener.com/latest/dex/pairs/base/0xdef'), error => error.code === 'market_provider_backoff' && error.provider_failure_code === 'market_provider_http_429' && error.retry_after_ms === 59000);
    assert.equal(calls, 1);
    now += 60000;
    assert.equal((await reader.read('https://api.dexscreener.com/latest/dex/pairs/base/0xdef')).ok, true);
    assert.equal(calls, 2);
  }
});

test('provider readers reject unexpected origins, query secrets, oversized streaming bodies and invalid JSON', async () => {
  let calls = 0;
  const reader = new MarketProviderReader({ cache: () => null, fetchFn: async () => { calls++; return json({ body: 'x'.repeat(100) }); } });
  for (const url of ['http://api.dexscreener.com/a','https://evil.example/a','https://api.dexscreener.com:444/a','https://api.dexscreener.com/a?api_key=secret']) await assert.rejects(reader.read(url), /origin_invalid/);
  assert.equal(calls, 0);
  await assert.rejects(reader.read('https://api.dexscreener.com/large', { maxBytes: 40 }), /too_large/);
  const invalid = new MarketProviderReader({ cache: () => null, fetchFn: async () => json(null) });
  await assert.rejects(invalid.read('https://api.dexscreener.com/invalid'), /response_invalid/);
});

test('DexScreener snapshots bind chain, pool and token, preserve missing fields and cache age', () => {
  const row = normalizeDexScreenerActivity(pair(), { chain: 'base', observedAt: new Date(NOW).toISOString(), nowMs: NOW + 30000 });
  assert.equal(row.market.price_usd, 2.5); assert.equal(row.market.volume_usd_5m, 8000);
  assert.equal(row.market.market_cap_usd, null); assert.equal(row.market.volume_usd_24h, null);
  assert.equal(row.market.market_age_seconds, 86400); assert.equal(row.age_seconds, 30);
  assert.equal(row.provenance.provider_ranking_is_raven_signal, false); assert.equal(row.execution_available, false);
  const options = { chain: 'base', observedAt: new Date(NOW).toISOString(), nowMs: NOW };
  for (const overrides of [{ chainId:'ethereum' },{pairAddress:'invalid'},{liquidity:{usd:0}},{priceUsd:null},{baseToken:{address:address(3),symbol:'SAME'}}]) assert.equal(normalizeDexScreenerActivity(pair(overrides),options),null);
  assert.equal(normalizeDexScreenerActivity(pair(),{...options,nowMs:NOW+121000}).context_state,'delayed');
});

test('Dexch capabilities keep an unsupported chain from poisoning global discovery', async () => {
  const requests = [];
  const p = new DexchDiscoveryProvider({ now: () => NOW, fetchFn: async url => {
    const u = new URL(url); requests.push(u);
    if (u.pathname.endsWith('filter-options')) return json({ data:{chains:[{key:'bsc'},{key:'robinhood'}]} });
    assert.equal(u.searchParams.get('chains'),'robinhood,bsc');
    return json({ data:[token('bsc'),token('robinhood')] });
  } });
  const result = await p.discovery({ chains:['solana','robinhood','bsc'] });
  assert.equal(result.rows.length,2); assert.deepEqual(result.unsupported_chains,['solana']);
  assert.equal(result.schema_version,'ravenos.token_discovery.dexch.v1'); assert.equal(requests.length,2);
});

test('stale Dexch capabilities and unavailable capability endpoints isolate each chain', async () => {
  for (const capabilityDown of [false,true]) {
    const p = new DexchDiscoveryProvider({ now:()=>NOW, fetchFn:async url=>{
      const u=new URL(url);
      if(u.pathname.endsWith('filter-options'))return capabilityDown?json({},503):json({data:{chains:[{key:'solana'},{key:'bsc'}]}});
      if(u.searchParams.get('chains').includes('solana'))return json({error:'unsupported'},400);
      return json({data:[token('bsc')]});
    }});
    const result=await p.discovery({chains:['solana','bsc']});
    assert.deepEqual(result.rows.map(row=>row.chain),['bsc']); assert.deepEqual(result.failed_chains,['solana']); assert.equal(result.next_cursor,null);
  }
});

test('Dexch holder and trader candidates are bounded and do not become PNL or trade evidence', () => {
  const identity={chain:'bsc',pool_address:address(1),token_address:address(2),quote_token_address:address(3)};
  const envelope={ok:true,chain:'bsc',token_address:address(2),schema_version:'ravenos.provider_holders.dexch.v1',provenance:{retrieved_at:new Date(NOW).toISOString()},rows:[{address:address(4),rank:1},{address:address(4),rank:2},{address:address(1),rank:3},{address:'bad',rank:4}]};
  const rows=dexchWalletCandidates(envelope,identity,{now:NOW/1000});
  assert.equal(rows.length,1); assert.equal(rows[0].address,address(4)); assert.equal(rows[0].discovery_source.source_kind,'top_holder');
  assert.equal(rows[0].realized_pnl,undefined); assert.equal(rows[0].transaction_hash,undefined);
  for(const changed of [{ok:false},{chain:'base'},{token_address:address(9)},{rows:null},{provenance:{retrieved_at:new Date(NOW-86401000).toISOString()}}])assert.deepEqual(dexchWalletCandidates({...envelope,...changed},identity,{now:NOW/1000}),[]);
  assert.deepEqual(dexchWalletCandidates({...envelope,token_address:null},{...identity,token_address:null}),[]);
  const trades={...envelope,schema_version:'ravenos.provider_trades.dexch.v1',rows:[{trader_address:address(5),observed_at:new Date(NOW).toISOString(),volume_usd:50000}]};
  const [candidate]=dexchWalletCandidates(trades,identity,{now:NOW/1000});
  assert.equal(candidate.discovery_source,undefined);assert.equal(candidate.volume_usd,undefined);
});
