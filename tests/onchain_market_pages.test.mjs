import test from 'node:test';
import assert from 'node:assert/strict';
import { onchainMarketPages, validOnchainMarketCursor } from '../lib/onchain_market_pages.mjs';
import worker from '../worker.mjs';
import { normalizeDexScreenerActivity } from '../lib/market_provider_fallbacks.mjs';
const address = n => '0x' + n.toString(16).padStart(40,'0');

test('pages preserve complete ordered identity and original timestamps with bounded payloads',()=>{
  const pulse={generated_at:new Date().toISOString(),duration:'1h',chains:['base'],rows:Array.from({length:2301},(_,i)=>({instrument_id:`base:pool:${i}`,observed_at:'2026-09-10T12:00:00Z'})),discovery_radar:{row_count:2301}};
  const pages=onchainMarketPages(pulse);
  assert.deepEqual(pages.map(p=>p.rows.length),[500,500,500,500,301]);
  assert.deepEqual(pages.flatMap(p=>p.rows),pulse.rows);
  assert.equal(new Set(pages.map(p=>p.pagination.snapshot_id)).size,1);
  assert(pages.slice(0,-1).every(p=>validOnchainMarketCursor(p.pagination.next_cursor)));
  assert.equal(pages.at(-1).pagination.next_cursor,null);
  assert(pages.every(p=>p.generated_at===pulse.generated_at&&p.discovery_radar.row_count===p.rows.length));
  for(const cursor of ['../../','abc.500','a'.repeat(24)+'.501','a'.repeat(24)+'.10000'])assert.equal(validOnchainMarketCursor(cursor),false);
});

test('Worker serves more than 2,000 usable tokens across immutable pages without additional provider reads',async()=>{
  const now=Date.now(),at=new Date(now).toISOString();
  const rows=Array.from({length:2303},(_,i)=>normalizeDexScreenerActivity({chainId:'base',pairAddress:address(i+10000),baseToken:{address:address(i+1),symbol:`MEME${i}`,name:`Meme ${i}`},quoteToken:{address:address(99999),symbol:'WETH'},priceUsd:'1',liquidity:{usd:100000},marketCap:1000000,volume:{m5:10000},txns:{m5:{buys:80,sells:20}},priceChange:{m5:3},pairCreatedAt:now-86400000},{chain:'base',observedAt:at,nowMs:now}));
  rows[0].market.liquidity_usd=1;rows[1].market.holder_count=1;
  const snapshot={ok:true,rows,generated_at:at,coverage:{tracked:rows.length}};
  let reads=0,calls=0;
  const env = { RAVENOS_PARTICIPATION_UNIVERSE_ENABLED: '1', RAVENOS_COINGECKO_ENABLED: '0', RAVENOS_MARKET_PROVIDER_FALLBACKS_ENABLED: '1', RAVENOS_CUSTOMER_DB: {
    prepare() { return { bind() { return {
      async first() { reads++; return { body_json: JSON.stringify(snapshot) }; }
    }; } }; }
  } };
  const prior=globalThis.fetch;globalThis.fetch=()=>{calls++;throw Error('No provider read allowed');};
  try{
    const first=await worker.fetch(new Request('https://ravenos.xyz/api/onchain/trending?chains=base&duration=5m&paged=1'),env);
    assert.equal(first.status,200);let page=await first.json();const result=[...page.rows],id=page.pagination.snapshot_id;
    assert.equal(page.rows.length,500);assert.equal(page.universe.qualified_tokens,2301);assert.equal(page.universe.delivery_limited,false);
    const databaseReads=reads;
    while(page.pagination.next_cursor){
      const response=await worker.fetch(new Request('https://ravenos.xyz/api/onchain/trending?chains=base&duration=5m&paged=1&cursor='+page.pagination.next_cursor),env);
      assert.equal(response.status,200);page=await response.json();assert.equal(page.pagination.snapshot_id,id);result.push(...page.rows);
    }
    assert.equal(result.length,2301);assert.equal(new Set(result.map(r=>r.instrument_id)).size,2301);assert.equal(calls,0);assert.equal(reads,databaseReads);
    assert(result.every(r=>r.observed_at===at&&r.market.liquidity_usd>=5000&&r.market.holder_count!==1));
    const wrong=await worker.fetch(new Request('https://ravenos.xyz/api/onchain/trending?chains=ethereum&duration=5m&paged=1&cursor='+id+'.500'),env);
    assert.equal(wrong.status,409);assert.equal((await wrong.json()).restart,true);
  }finally{globalThis.fetch=prior;}
});
