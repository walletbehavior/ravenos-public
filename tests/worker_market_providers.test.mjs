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
