import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker.mjs';
const address = n => '0x' + n.toString(16).padStart(40,'0');
const TOKEN=address(202),POOL=address(201),QUOTE=address(203);
const now=Date.now(),time=Math.floor(now/60000)*60;
const json = value => new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const env={RAVENOS_MARKET_PROVIDER_FALLBACKS_ENABLED:'1',RAVENOS_DEXCH_CHARTS_ENABLED:'1',RAVENOS_DEXCH_DISCOVERY_ENABLED:'1',RAVENOS_DEXCH_COMMERCIAL_USE_ACKNOWLEDGED:'1',ONCHAIN_CHART_PROVIDER:'coingecko'};
const chartUrl=()=>'https://ravenos.xyz/api/terminal/chart?'+new URLSearchParams({market:'crypto_spot',asset:'TEST/WBNB',timeframe:'1m',limit:'240',chain:'bsc',pair_address:POOL,token_address:TOKEN,quote_address:QUOTE,instrument_scope:'exact_pool'});

test('Terminal uses Dexch as a normal chart provider and reuses cached history',async()=>{
 const previous=globalThis.fetch;const calls=[];
 globalThis.fetch=async input=>{
  const url=new URL(String(input));calls.push(url);
  if(url.hostname==='api.dexch.art' && url.pathname.endsWith('/candles'))return json({data:Array.from({length:240},(_,i)=>({time:time-(239-i)*60,open:1,high:3,low:1,close:2,volume:10}))});
  if(url.hostname==='api.dexch.art')return json({data:{chain:'bsc',address:TOKEN,symbol:'TEST',poolAddress:POOL,quoteToken:QUOTE,quoteSymbol:'WBNB',decimals:18,quoteDecimals:18,dexId:'pancakeswap',launchTime:new Date(now-86400000).toISOString(),priceUsd:2,liquidityUsd:10000}});
  if(url.hostname==='api.dexscreener.com')return json({pairs:[{chainId:'bsc',pairAddress:POOL,baseToken:{address:TOKEN},quoteToken:{address:QUOTE},pairCreatedAt:now-86400000,liquidity:{usd:10000}}]});
  throw Error('unexpected provider '+url.hostname);
 };
 try {
  for(let attempt=0;attempt<2;attempt++){
   const response=await worker.fetch(new Request(chartUrl()),env);const envelope=await response.json();const chart=envelope.data||envelope;
   assert.equal(response.status,200);assert.equal(chart.ok,true,JSON.stringify(chart));assert.equal(chart.candles.length,240);
   assert.equal(chart.candle_series.provider,'dexch');assert.equal(chart.provider_selection.selected,'dexch');assert.equal(chart.provider_selection.fallback,false);
   assert.equal(chart.source_label,'Dexch market prices');assert.equal(chart.instrument.pool_address,POOL);assert.equal(chart.candle_series.raven_observations_are_candles,false);
  }
  assert.equal(calls.filter(url=>url.pathname.endsWith('/candles')).length,1);assert.equal(calls.some(url=>url.hostname.includes('coingecko')),false);
 }finally{globalThis.fetch=previous;}
});

test('every discovery chain has a current pool snapshot without consuming CoinGecko calls',async()=>{
 const previous=globalThis.fetch,calls=[];
 const chains=['solana','base','bsc','ethereum','robinhood'];
 const solToken='So11111111111111111111111111111111111111112',solQuote='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',solPool='9xQeWvG816bUx9EPfPqpQfdgj7QdQL6MH5z3ExvMNYBp';
 globalThis.fetch=async input=>{
  const url=new URL(String(input));calls.push(url.hostname);
  if(url.hostname==='api.dexch.art')return json(url.pathname.endsWith('filter-options')?{data:{chains:[{key:'bsc'},{key:'robinhood'}]}}:{data:[]});
  if(url.hostname==='api.dexscreener.com'){
   if(url.pathname.endsWith('/latest/v1'))return json(chains.map(chain=>({chainId:chain,tokenAddress:chain==='solana'?solToken:address(700)})));
   if(url.pathname.includes('/search'))return json({pairs:[]});
   const chain=url.pathname.split('/')[3];
   return json([{chainId:chain,pairAddress:chain==='solana'?solPool:address(701),baseToken:{address:chain==='solana'?solToken:address(700),symbol:'TEST'},quoteToken:{address:chain==='solana'?solQuote:address(702),symbol:'USDC'},priceUsd:'1.3',liquidity:{usd:10000},volume:{m5:5000},priceChange:{m5:2},txns:{m5:{buys:5,sells:3}}}]);
  }
  throw Error('unexpected provider '+url.hostname);
 };
 try {
  const response=await worker.fetch(new Request('https://ravenos.xyz/api/onchain/trending?chains='+chains.join(',')+'&duration=5m'),env);
  const result=await response.json();assert.equal(result.ok,true,JSON.stringify(result));
  assert.deepEqual([...new Set(result.rows.map(row=>row.chain_id))].sort(),chains.sort());
  assert.equal(calls.some(host=>host.includes('coingecko')),false);
 }finally{globalThis.fetch=previous;}
});

test('production chart fallback preserves exact identity on every chain and makes no retired-provider calls',async()=>{
 const previous=globalThis.fetch,calls=[];
 const production={RAVENOS_DEXSCREENER_CHARTS_ENABLED:'1',RAVENOS_COINGECKO_ENABLED:'0',RAVENOS_RELEASE_ENFORCE:'1',RAVENOS_ONCHAIN_CHART_PROVIDER_ORDER:'dexch,dexscreener'};
 const manifests = Object.fromEntries(['ravenos_release.json','ravenos_build.json','ravenos_deploy_manifest.json'].map(name => [name,JSON.parse(readFileSync('.deploy-public/'+name,'utf8'))]));
 const release=manifests['ravenos_release.json'];
 Object.assign(production,{RAVENOS_RELEASE_ID:release.release_id,RAVENOS_SOURCE_COMMIT:release.source_commit,
   RAVENOS_STATIC_ASSET_MANIFEST_SHA256:release.static_asset_manifest_sha256,RAVENOS_PUBLIC_ORIGIN_CONTRACT_VERSION:release.public_origin_contract_version,
   CF_VERSION_METADATA:{id:'11111111-2222-3333-4444-555555555555',tag:release.release_id},
   ASSETS:{fetch:async request=>{const value=manifests[new URL(request.url).pathname.slice(1)];return value?json(value):new Response('missing',{status:404});}}});
 const { qualifiedChartSurface }=await import('../lib/chart_release_validation.mjs');
 const { dexscreenerChartSurface,validateDexscreenerChartSurface }=await import('../ravenos-chart-data-plane.js');
 globalThis.fetch=async input=>{
  const url=new URL(String(input));calls.push(url.hostname);
  if(url.hostname!=='api.dexscreener.com')throw Error('unexpected provider '+url.hostname);
  const chain=url.pathname.split('/')[4],pool=url.pathname.split('/')[5];
  return json({pairs:[{chainId:chain,pairAddress:pool,baseToken:{address:chain==='solana'?'So11111111111111111111111111111111111111112':address(801),symbol:'TEST'},quoteToken:{address:chain==='solana'?'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v':address(802),symbol:'USDC'},dexId:'uniswap'}]});
 };
 try{
  for(const chain of ['solana','base','bsc','ethereum','robinhood']){
   const args={chain,pairAddress:chain==='solana'?'58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2':address(800),tokenAddress:chain==='solana'?'So11111111111111111111111111111111111111112':address(801),quoteAddress:chain==='solana'?'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v':address(802),timeframe:'1m'};
   const query=new URLSearchParams({market:'crypto_spot',asset:'TEST/USDC',timeframe:'1m',chain,pair_address:args.pairAddress,token_address:args.tokenAddress,quote_address:args.quoteAddress});
   const response=await worker.fetch(new Request('https://ravenos.xyz/api/terminal/chart?'+query),production);const body=await response.json();const chart=body.data||body;
   assert.equal(chart.ok,true,JSON.stringify(chart));assert.equal(qualifiedChartSurface(chart,args),true,JSON.stringify(chart));
   assert.equal(qualifiedChartSurface(chart,{...args,nativeRequired:true}),false);
   assert.equal(chart.capabilities.raven_candle_analytics,false);assert.equal(chart.candles.length,0);
   assert.equal(validateDexscreenerChartSurface({...chart.chart_surface,url:'https://evil.example/'},args),false);
   assert.equal(validateDexscreenerChartSurface({...chart.chart_surface,url:chart.chart_surface.url+'&wallet=private'},args),false);
   assert.equal(validateDexscreenerChartSurface(chart.chart_surface,{...args,tokenAddress:address(999)}),false);
   query.set('token_address',chain==='solana'?args.quoteAddress:address(999));
   const bad=await (await worker.fetch(new Request('https://ravenos.xyz/api/terminal/chart?'+query),production)).json();
   assert.equal((bad.data||bad).ok,false);assert.equal((bad.data||bad).chart_surface,undefined);
  }
  assert.deepEqual([...new Set(calls)],['api.dexscreener.com']);
  assert.throws(()=>dexscreenerChartSurface({chain:'../evil'}),/unsupported/);
 }finally{globalThis.fetch=previous;}
});

test('retired commercial adapters are disabled in production even with retained credentials',async()=>{
 const { onchainProviderRuntime,onchainChartProviderOrder }=await import('../lib/onchain_chart_providers.mjs');
 assert.deepEqual(onchainChartProviderOrder({}),['dexch','dexscreener']);
 assert.equal(onchainProviderRuntime('dexpaprika',{RAVENOS_RELEASE_ENFORCE:'1'}).runtime_allowed,false);
 assert.equal(onchainProviderRuntime('coingecko',{RAVENOS_RELEASE_ENFORCE:'1',RAVENOS_COINGECKO_ENABLED:'0',ONCHAIN_CHART_PROVIDER_PLAN:'basic',ONCHAIN_CHART_PROVIDER_SECRET:'retained-test-secret'}).runtime_allowed,false);
});
