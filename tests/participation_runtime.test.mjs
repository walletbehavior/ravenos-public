import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('participation collection, compressed D1 storage and recovery run in workerd', async t => {
  const migration = ['0048_participation_snapshot.sql', '0049_market_discovery_frontier.sql']
    .map(name => readFileSync('customer-migrations/' + name, 'utf8')).join('\n');
  const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
  const source = `
    import {collectParticipationUniverse,createParticipationSnapshotStore,refreshParticipationSnapshot} from './lib/participation_universe.mjs';
    import {MarketProviderReader} from './lib/market_provider_fallbacks.mjs';
    export default {async fetch(request,env) {
      try {
        const reader=new MarketProviderReader();
        if(new URL(request.url).pathname==='/redirect') return Response.json(await reader.read('https://api.dexscreener.com/redirect'));
        if(new URL(request.url).pathname.startsWith('/cooldown/')) return Response.json(await reader.read('https://api.dexscreener.com/tokens/v1/base/'+new URL(request.url).pathname.split('/').at(-1)));
        await env.DB.exec(${JSON.stringify(migration.replace(/--[^\n]*/g, '').replace(/\s+/g, ' '))});
        const now=Date.now(), address='0x'+'1'.repeat(40), pool='0x'+'2'.repeat(40), quote='0x'+'3'.repeat(40);
        await reader.snapshot('https://api.dexscreener.com/tokens/v1/base/'+address);
        const payload=await collectParticipationUniverse({dexchEnabled:false,
          readKnownMarkets:async()=>[{chain:'base',token_address:address}],
          readPairs:async()=>reader.snapshot('https://api.dexscreener.com/tokens/v1/base/'+address)
        });
        const store=createParticipationSnapshotStore(env.DB);
        const rows=Array.from({length:1000},()=>payload.rows[0]);
        await refreshParticipationSnapshot(store,async()=>({...payload,rows}));
        const restored=(await store.read()).payload;
        const stored=await env.DB.prepare("SELECT body_json FROM ravenos_participation_snapshot WHERE scope='onchain'").first();
        return Response.json({tracked:payload.rows.length,restored:restored.rows.length,
          encoding:JSON.parse(stored.body_json).encoding,observed_at:restored.rows[0].observed_at,
          original_observed_at:payload.rows[0].observed_at});
      } catch(error) {return Response.json({error:error.message},{status:503});}
    }};
  `;
  const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['node:*'] });
  let calls = 0;
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    d1Databases: ['DB'], outboundService: request => {
      calls += 1;
      const url=new URL(request.url); assert.equal(url.host,'api.dexscreener.com');
      if(url.pathname==='/redirect') return new Response(null,{status:302,headers:{location:'https://untrusted.fixture.invalid/'}});
      if(url.pathname.endsWith('/limited')) return new Response(null,{status:429,headers:{'retry-after':'120'}});
      return Response.json([{
        chainId:'base',pairAddress:'0x'+'2'.repeat(40),baseToken:{address:'0x'+'1'.repeat(40),symbol:'TEST'},
        quoteToken:{address:'0x'+'3'.repeat(40),symbol:'ETH'},priceUsd:'1',marketCap:800000,liquidity:{usd:100000},
        pairCreatedAt:Date.now()-86400000,priceChange:{h6:4,m5:1},volume:{h6:20000,m5:1000},txns:{m5:{buys:10,sells:5}}
      }]);
    },
  }));
  t.after(() => mf.dispose());
  const response = await mf.dispatchFetch('https://fixture.invalid/'), body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.tracked, 1); assert.equal(body.restored, 1000); assert.equal(body.encoding, 'gzip-base64');
  assert.equal(body.observed_at, body.original_observed_at); assert.equal(calls, 1);
  const redirect=await mf.dispatchFetch('https://fixture.invalid/redirect');
  assert.equal(redirect.status,503); assert.equal((await redirect.json()).error,'market_provider_http_302');
  assert.equal(calls,2);
  const limited=await mf.dispatchFetch('https://fixture.invalid/cooldown/limited');
  assert.equal(limited.status,503); assert.equal((await limited.json()).error,'market_provider_http_429');
  const cold=await mf.dispatchFetch('https://fixture.invalid/cooldown/another-market');
  assert.equal(cold.status,503); assert.equal((await cold.json()).error,'market_provider_backoff');
  assert.equal(calls,3, 'a cold reader in workerd honors the prior public edge cooldown');
});

test('the production shared reader paces real workerd timers and stops queued reads after a cooldown', async t => {
  const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
  const bundle = await build({ stdin: { contents: `
    import {sharedMarketProviderReader as reader} from './lib/market_provider_fallbacks.mjs';
    export default {async fetch(request) {
      const path=new URL(request.url).pathname;
      const rows=await Promise.allSettled(['base','ethereum','robinhood'].map(chain=>
        reader.snapshot('https://api.dexscreener.com/tokens/v1/'+chain+path)));
      return Response.json(rows.map(row=>row.status==='fulfilled'?{cache_hit:row.value.cache_hit}:{error:row.reason.code}));
    }};`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['node:*'] });
  const calls = [];
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    outboundService: request => {
      calls.push({ at: Date.now(), path: new URL(request.url).pathname });
      return request.url.endsWith('/limited') ? new Response(null, { status: 429, headers: { 'retry-after': '120' } }) : Response.json({ ok: true });
    },
  }));
  t.after(() => mf.dispose());
  const first = await (await mf.dispatchFetch('https://fixture.invalid/prices')).json();
  assert.deepEqual(first, Array.from({ length: 3 }, () => ({ cache_hit: false })));
  assert.equal(calls.length, 3);
  for (let i = 1; i < calls.length; i++) assert(calls[i].at - calls[i - 1].at >= 225, 'provider starts remain spaced in the Worker runtime');
  const cached = await (await mf.dispatchFetch('https://fixture.invalid/prices')).json();
  assert(cached.every(row => row.cache_hit));assert.equal(calls.length, 3);
  const limited = await (await mf.dispatchFetch('https://fixture.invalid/limited')).json();
  assert.equal(calls.length, 4);
  assert.equal(limited.filter(row => row.error === 'market_provider_http_429').length, 1);
  assert.equal(limited.filter(row => row.error === 'market_provider_backoff').length, 2);
});
