import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { projectMobulaTrades, fetchMobulaTrades, mobulaTradeUrl } from '../lib/mobula_trades.mjs';
import { createMobulaMarketStore, loadMobulaMarketTrades, MobulaMarketPolicy } from '../lib/mobula_market_cache.mjs';
import worker from '../worker.mjs';
import { publicOnchainTradeUnavailable } from '../lib/onchain_trade_projection.mjs';

const NOW = Date.now(), a = n => '0x'+n.toString(16).padStart(40,'0');
const identity = { chain:'base', pool_address:a(1), token_address:a(2), quote_token_address:a(3), instrument_id:'base:pool:'+a(1) };
const solana = { chain:'solana', pool_address:'6HfaJiUuTXFZEfmdkQSNbvfe6i95Nh2wUVJ5dWMf7gtw',
  token_address:'zGh48JtNHVBb5evgoZLXwgPD2Qu4MhkWdJLGDAupump', quote_token_address:'So11111111111111111111111111111111111111112' };
const trade = (id=identity, overrides={}) => ({ id:'123', operation:'regular', type:'buy', blockchain:id.chain,
  marketAddress:id.pool_address, baseToken:{address:id.token_address}, quoteToken:{address:id.quote_token_address},
  baseTokenAmount:40, quoteTokenAmount:0.01, baseTokenAmountUSD:20, quoteTokenAmountUSD:20,
  baseTokenPriceUSD:0.5, quoteTokenPriceUSD:2000, date:NOW-5000,
  transactionHash:id.chain==='solana'?'2o3fYmjZjPoxWQacZhqAeKaoqUDDKtDpZHgkjEJ1pxqcus1H4t1b4TRpiF2RWGQgYzycJbPgXSzeZYPJqXt9NMvE':'0x'+'a'.repeat(64),
  transactionSenderAddress:id.chain==='solana'?'HhGpDzS1i2GUeigxKAwSD4oHRvYkqJp3e7cGwEMZK3zw':a(4),
  swapRecipient:a(5), labels:['smart-money'], walletMetadata:{private_fixture:'must not escape'}, ...overrides });
const response = body => new Response(JSON.stringify(body), {headers:{'content-type':'application/json'}});
function database(t) {
  const raw = new DatabaseSync(':memory:');t.after(()=>raw.close());
  raw.exec(readFileSync('customer-migrations/0051_mobula_market_cache.sql','utf8'));
  return {raw,prepare(sql){return{bind(...args){return{
    async first(){return raw.prepare(sql).get(...args);},
    async run(){return {meta:{changes:Number(raw.prepare(sql).run(...args).changes)}};},
  };}};}};
}

for (const id of [identity,{...identity,chain:'ethereum'},solana]) test(`Mobula preserves ${id.chain} pool, amounts, direction and sender`,()=>{
  const body = projectMobulaTrades({data:[trade(id)]},id,{now:NOW});
  assert.equal(body.ok,true);assert.equal(body.coverage.exact_pool_verified,true);
  assert.equal(body.trades[0].token_amount,40);assert.equal(body.trades[0].quote_amount,0.01);
  assert.equal(body.trades[0].side,'buy');assert.equal(body.trades[0].trader_address,trade(id).transactionSenderAddress);
  assert.equal(body.source.label,'Mobula');assert.equal(body.source.attribution_url,'https://mobula.io');
  assert.equal(body.execution_boundary.submission_available,false);
  assert(!JSON.stringify(body).includes('private_fixture'));assert(!JSON.stringify([body.trades,body.active_traders]).includes('smart-money'));
  const url = new URL(mobulaTradeUrl(id));assert.equal(url.searchParams.get('mode'),'pair');
  assert.equal(url.searchParams.get('address'),id.pool_address);assert.equal(url.searchParams.get('swapTypes'),'REGULAR');
});

test('inverse selected asset reverses side, prices and both amounts without a guessed quote',()=>{
  const id={...identity,token_address:identity.quote_token_address,quote_token_address:identity.token_address};
  const row=projectMobulaTrades({data:[trade()]},id,{now:NOW}).trades[0];
  assert.equal(row.side,'sell');assert.equal(row.price_usd,2000);assert.equal(row.token_amount,0.01);assert.equal(row.quote_amount,40);
});

test('empty samples, invalid provider rows and exhausted budgets have distinct recovery states',()=>{
  assert.equal(publicOnchainTradeUnavailable(Error('mobula_no_recent_swaps'),identity).payload.error,'onchain_trade_no_recent_swaps');
  assert.equal(publicOnchainTradeUnavailable(Error('mobula_no_matching_recent_swaps'),identity).payload.error,'onchain_trade_temporarily_unavailable');
  assert.equal(publicOnchainTradeUnavailable(Error('onchain_trade_budget_limited'),identity).payload.error,'onchain_trade_budget_limited');
  assert.equal(publicOnchainTradeUnavailable(Error('onchain_trade_refresh_pending'),identity).payload.state,'refreshing');
});

test('reject deposits, unrelated pools/chains/assets, invalid times, impossible prices and missing IDs',()=>{
  const invalid=[{operation:'deposit'},{type:'withdrawal'},{marketAddress:a(8),marketAddresses:[identity.pool_address]},
    {blockchain:'Ethereum'},{baseToken:{address:a(8)}},{quoteToken:{address:a(8)}},
    {date:NOW+600001},{date:NOW-27*3600000},{date:Number.MAX_SAFE_INTEGER},{date:String(NOW)},
    {baseTokenAmount:-10},{baseTokenPriceUSD:0},{baseTokenAmountUSD:0},{id:undefined}];
  const body=projectMobulaTrades({data:[...invalid.map(x=>trade(identity,x)),trade(),trade()]},identity,{now:NOW});
  assert.equal(body.trades.length,1);assert.equal(body.trades[0].event_id,'mobula:123');
  const badSol=trade(solana,{baseToken:{address:solana.token_address.toUpperCase()}});
  assert.equal(projectMobulaTrades({data:[badSol]},solana,{now:NOW}).ok,false);
  assert.throws(()=>mobulaTradeUrl({...identity,chain:'robinhood'}),/identity_invalid/);
});

test('provider transport confines credentials, streams within a cap and sanitizes failures',async()=>{
  const key='private-mobula-fixture';let seen;
  await fetchMobulaTrades(identity,key,{fetchImpl:async(url,init)=>{seen={url,init};return response({data:[trade()]});}});
  assert.equal(seen.init.redirect,'manual');assert.equal(seen.init.headers.Authorization,key);assert(!seen.url.includes(key));
  await assert.rejects(fetchMobulaTrades(identity,key,{fetchImpl:async()=>new Response('redirect',{status:302,headers:{location:'https://evil.test'}})}),/mobula_http_302/);
  await assert.rejects(fetchMobulaTrades(identity,key,{fetchImpl:async()=>new Response('x'.repeat(1024*1024+1))}),/mobula_payload_too_large/);
  await assert.rejects(fetchMobulaTrades(identity,key,{fetchImpl:async()=>{throw Error(key);}}),/^Error: mobula_transport_unavailable$/);
  await assert.rejects(fetchMobulaTrades(identity,key,{fetchImpl:async()=>response({error:key})}),/mobula_payload_invalid/);
});

test('a durable cache is reused across callers and failed refresh retains original time',async t=>{
  const db=database(t), env={RAVENOS_CUSTOMER_DB:db,RAVENOS_MOBULA_TRADES_ENABLED:'1',MOBULA_API_KEY:'fixture-only'};
  let time=NOW,calls=0,fail=false;
  const read=()=>loadMobulaMarketTrades(identity,{env,now:()=>time,fetchImpl:async()=>{calls++;if(fail)throw Error('network');return response({data:[trade()]});}});
  const first=await read();time+=30000;const cached=await read();assert.equal(calls,1);assert.equal(cached.observed_at,first.observed_at);
  time=NOW+65000;fail=true;const retained=await read();assert.equal(calls,2);assert.equal(retained.delivery.state,'retained');
  assert.equal(retained.observed_at,first.observed_at);assert.equal(retained.freshness.state,'recent');
  time+=30000;await read();assert.equal(calls,2);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM ravenos_mobula_market_requests').get().n,2);
  time=NOW+700000;await assert.rejects(read(),/mobula_transport_unavailable/);assert.equal(calls,3);
  assert(!JSON.stringify(db.raw.prepare('SELECT * FROM ravenos_mobula_market_cache').get()).includes('fixture-only'));
});

test('concurrent collectors reserve once globally and honor the per-market minute',async t=>{
  const store=createMobulaMarketStore(database(t));
  const claims=await Promise.all(Array.from({length:10},(_,i)=>store.claim('market-'+i,NOW)));
  assert.equal(claims.filter(x=>x.id).length,1);
  assert.equal((await store.claim('market-1',NOW+1500)).id?.length>0,true);
  assert.equal((await store.claim('market-0',NOW+3000)).error,'onchain_trade_refresh_pending');
  assert((await store.claim('market-0',NOW+60000)).id);
});

test('daily and monthly ceilings survive distinct markets and reset only at UTC boundaries',async t=>{
  const db=database(t),store=createMobulaMarketStore(db),time=Date.parse('2026-09-20T18:00:00Z');
  const insert=db.raw.prepare("INSERT INTO ravenos_mobula_market_requests VALUES (?,?,?,'ok',NULL)");
  for(let i=0;i<MobulaMarketPolicy.daily_requests;i++)insert.run('d'+i,'m'+i,time-7200000+i);
  assert.equal((await store.claim('new',time)).error,'onchain_trade_budget_limited');
  assert((await store.claim('new',Date.parse('2026-09-21T00:00:01Z'))).id);
  for(let i=0;i<MobulaMarketPolicy.monthly_requests-MobulaMarketPolicy.daily_requests-1;i++)insert.run('p'+i,'p'+i,Date.parse('2026-09-01T00:00:00Z')+i);
  assert.equal((await store.claim('another',Date.parse('2026-09-22T12:00:00Z'))).error,'onchain_trade_budget_limited');
  assert((await store.claim('another',Date.parse('2026-10-01T00:00:00Z'))).id);
});

test('provider account failure backs off all pools; unknown cache identities never leak',async t=>{
  const db=database(t),store=createMobulaMarketStore(db);
  const claim=await store.claim('a',NOW);await store.finish(claim.id,Error('mobula_http_403'));
  assert.equal((await store.claim('b',NOW+5000)).error,'mobula_transport_unavailable');
  assert((await store.claim('b',NOW+3600001)).id);
  const env={RAVENOS_CUSTOMER_DB:db,RAVENOS_MOBULA_TRADES_ENABLED:'1',MOBULA_API_KEY:'fixture'};
  const wrong={...identity,token_address:a(99)};
  const fakeStore={read:async()=>({payload:projectMobulaTrades({data:[trade(wrong)]},wrong,{now:NOW}),observedAt:NOW}),claim:async()=>({error:'onchain_trade_refresh_pending'})};
  await assert.rejects(loadMobulaMarketTrades(identity,{env,store:fakeStore,now:()=>NOW}),/refresh_pending/);
});

test('public Worker serves the validated Mobula tape with no CoinGecko call or credential output',async t=>{
  const db=database(t),prior=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,init)=>{calls.push(String(url));assert.equal(init.headers.Authorization,'server-fixture');return response({data:[trade()]});};
  t.after(()=>{globalThis.fetch=prior;});
  const env={RAVENOS_CUSTOMER_DB:db,RAVENOS_MOBULA_TRADES_ENABLED:'1',MOBULA_API_KEY:'server-fixture'};
  const url='https://app.ravenos.xyz/api/onchain/trades?'+new URLSearchParams({chain:identity.chain,pair_address:identity.pool_address,token_address:identity.token_address,quote_address:identity.quote_token_address});
  for(let i=0;i<2;i++){
    const result=await worker.fetch(new Request(url),env);const body=await result.json();
    assert.equal(result.status,200);assert.equal(body.ok,true,JSON.stringify(body));assert.equal(body.source.label,'Mobula');
    assert(!JSON.stringify(body).includes('server-fixture'));assert.equal(body.trades[0].quote_amount,0.01);
  }
  assert.equal(calls.length,1);assert(calls.every(url=>url.startsWith('https://api.mobula.io/')));
});
