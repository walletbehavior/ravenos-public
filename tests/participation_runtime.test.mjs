import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('participation collection, compressed D1 storage and recovery run in workerd', async t => {
  const migration = readFileSync('customer-migrations/0048_participation_snapshot.sql', 'utf8');
  const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
  const source = `
    import {collectParticipationUniverse,createParticipationSnapshotStore,refreshParticipationSnapshot} from './lib/participation_universe.mjs';
    export default {async fetch(request,env) {
      try {
        await env.DB.exec(${JSON.stringify(migration.replace(/--[^\n]*/g, '').replace(/\s+/g, ' '))});
        const now=Date.now(), address='0x'+'1'.repeat(40), pool='0x'+'2'.repeat(40), quote='0x'+'3'.repeat(40);
        const payload=await collectParticipationUniverse({dexchEnabled:false,
          readKnownMarkets:async()=>[{chain:'base',token_address:address}],
          readPairs:async()=>({observed_at:new Date(now).toISOString(),value:[{
            chainId:'base',pairAddress:pool,baseToken:{address,symbol:'TEST'},quoteToken:{address:quote,symbol:'ETH'},
            priceUsd:'1',marketCap:800000,liquidity:{usd:100000},pairCreatedAt:now-86400000,
            priceChange:{h6:4,m5:1},volume:{h6:20000,m5:1000},txns:{m5:{buys:10,sells:5}}
          }]})
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
    d1Databases: ['DB'], outboundService: () => { calls += 1; return new Response(null, { status: 503 }); },
  }));
  t.after(() => mf.dispose());
  const response = await mf.dispatchFetch('https://fixture.invalid/'), body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.tracked, 1); assert.equal(body.restored, 1000); assert.equal(body.encoding, 'gzip-base64');
  assert.equal(body.observed_at, body.original_observed_at); assert.equal(calls, 0);
});
