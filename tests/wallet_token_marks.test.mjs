import test from 'node:test';
import assert from 'node:assert/strict';
import { selectWalletTokenMark, loadWalletTokenMarks, rememberSeenWalletTokenMarks, applyWalletTokenMark, walletTokenMarkSummary } from '../lib/customer_trade/wallet_token_marks.mjs';
import { createSolanaWalletProfileReads } from '../lib/customer_trade/solana_wallet_profile_provider.mjs';
import { WALLET_TOKEN_PROGRAMS } from '../lib/customer_trade/solana_wallet_holdings.mjs';
import { MarketProviderReader } from '../lib/market_provider_fallbacks.mjs';

const T='0x'+'a1'.repeat(20),Q='0x'+'a2'.repeat(20),P='0x'+'a3'.repeat(20),NOW=1788876000;
const SOL='So11111111111111111111111111111111111111112',USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',POOL='11111111111111111111111111111111';
const pair=(overrides={})=>({chainId:'robinhood',pairAddress:P,baseToken:{address:T},quoteToken:{address:Q},priceUsd:'0.001368',liquidity:{usd:155189.94},txns:{h1:{buys:80,sells:35}},...overrides});
function edge(){const map=new Map();return {async match(r){return map.get(r.url)?.clone();},async put(r,v){assert(!r.url.includes('key'));map.set(r.url,v.clone());}};}

test('exact chain, base-token and pool identity determine a mark; symbols and quote-side prices do not',()=>{
  assert.equal(selectWalletTokenMark('robinhood',T,[pair()],NOW).state,'available');
  for(const changed of [{chainId:'base'},{baseToken:{address:Q},quoteToken:{address:T}},{pairAddress:'bogus'},{quoteToken:{address:T}},{priceUsd:'NaN'}])assert.notEqual(selectWalletTokenMark('robinhood',T,[pair(changed)],NOW).state,'available');
  assert.equal(selectWalletTokenMark('unsupported',T,[pair()],NOW),null);
  const sol=selectWalletTokenMark('solana',SOL,[pair({chainId:'solana',pairAddress:POOL,baseToken:{address:SOL},quoteToken:{address:USDC}})],NOW);
  assert.equal(sol.contract,SOL);assert.equal(sol.state,'available');
});

test('thin, inactive and materially disagreeing pools cannot create holdings value',()=>{
  assert.equal(selectWalletTokenMark('robinhood',T,[pair({liquidity:{usd:0.14}})],NOW).state,'thin_liquidity');
  assert.equal(selectWalletTokenMark('robinhood',T,[pair({txns:{h1:{buys:0,sells:0}}})],NOW).state,'inactive_market');
  const result=selectWalletTokenMark('robinhood',T,[pair(),pair({pairAddress:Q,priceUsd:'0.03',liquidity:{usd:120000}})],NOW);
  assert.equal(result.state,'conflicting_pools');assert.equal(result.price,null);
});

test('already seen Discover pairs satisfy a wallet lookup without another provider request',async()=>{
  const priceCache=new Map();rememberSeenWalletTokenMarks([pair()],{now:NOW,priceCache});
  const result=await loadWalletTokenMarks({chain:'robinhood',contracts:[T],now:NOW+10,priceCache,fetchImpl:()=>{throw Error('must not fetch');}});
  assert.equal(result.request_count,0);assert.equal(result.cached_tokens,1);assert.equal(result.rows[0].sampled_at,NOW);
});

test('token references share edge cache across wallets and worker instances, preserving observation age',async()=>{
  const cache=edge();let calls=0;
  const input={chain:'robinhood',contracts:[T],now:NOW,cache,priceCache:new Map(),fetchImpl:async(url,init)=>{calls++;assert.equal(init.redirect,'manual');assert.equal(new URL(url).hostname,'api.dexscreener.com');return Response.json([pair()]);}};
  assert.equal((await loadWalletTokenMarks(input)).request_count,1);
  const again=await loadWalletTokenMarks({...input,now:NOW+1,priceCache:new Map()});
  assert.equal(again.request_count,0);assert.equal(calls,1);assert.equal(again.rows[0].sampled_at,NOW);
  await loadWalletTokenMarks({...input,now:NOW+301,priceCache:new Map()});assert.equal(calls,2);
});

test('wallet price requests honor the shared market cooldown for new tokens and chains',async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'120'}});};
  const providerReader=new MarketProviderReader({fetchFn:fetchImpl,now:()=>NOW*1000,cache:()=>null});
  await assert.rejects(providerReader.read('https://api.dexscreener.com/tokens/v1/base/'+T),/429/);
  const result=await loadWalletTokenMarks({chain:'robinhood',contracts:[T],now:NOW+1,priceCache:new Map(),providerReader,fetchImpl});
  assert.equal(calls,1);
  assert.equal(result.rows.length,0);assert.equal(result.request_count,0);
});

test('an existing market response supplies a wallet mark with its original observation time',async()=>{
  let now=NOW,calls=0;
  const fetchImpl=async()=>{calls++;return Response.json([pair()]);};
  const providerReader=new MarketProviderReader({fetchFn:fetchImpl,now:()=>now*1000,cache:()=>null});
  await providerReader.snapshot('https://api.dexscreener.com/tokens/v1/robinhood/'+T);
  now+=20;
  const result=await loadWalletTokenMarks({chain:'robinhood',contracts:[T],now,priceCache:new Map(),providerReader,fetchImpl});
  assert.equal(calls,1);assert.equal(result.request_count,0);assert.equal(result.rows[0].sampled_at,NOW);
});

test('missing and provider-error observations are negatively cached and never expose response details',async()=>{
  for(const fetchImpl of [async()=>Response.json([]),async()=>{throw Error('secret-provider-body');}]){
    const input={chain:'robinhood',contracts:[T],now:NOW,priceCache:new Map(),fetchImpl};
    const first=await loadWalletTokenMarks(input),second=await loadWalletTokenMarks({...input,now:NOW+5});
    assert.equal(first.rows.length,0);assert.equal(second.request_count,0);assert.equal(second.rows.length,0);
    assert(!JSON.stringify(first).includes('secret'));
  }
});

test('bounded token batching and simultaneous same-batch lookups share provider work',async()=>{
  let calls=0;const priceCache=new Map();
  const input={chain:'base',contracts:Array.from({length:100},(_,i)=>'0x'+(i+1).toString(16).padStart(40,'0')),now:NOW,priceCache,
    fetchImpl:async(url)=>{calls++;assert(new URL(url).pathname.split('/').at(-1).split(',').length<=30);await new Promise(r=>setTimeout(r,5));return Response.json([]);}};
  const [one,two]=await Promise.all([loadWalletTokenMarks(input),loadWalletTokenMarks(input)]);
  assert.equal(one.requested_tokens,60);assert.equal(two.requested_tokens,60);assert.equal(calls,2);
});

test('marks and totals use integer precision; missing prices do not become zero',()=>{
  const mark=selectWalletTokenMark('robinhood',T,[pair()],NOW);
  const token=applyWalletTokenMark({contract:T,balance_raw:'9007199254740993',decimals:6},mark);
  assert.equal(token.provider_mark_value_usd,'12321848.580485');
  assert.equal(token.mark_evidence.position_exceeds_ten_percent_of_pool,true);
  const summary=walletTokenMarkSummary([token,{contract:Q,provider_mark_value_usd:null}]);
  assert.equal(summary.visible_priced_rows,1);assert.equal(summary.visible_unpriced_rows,1);assert.equal(summary.visible_provider_mark_value_usd,token.provider_mark_value_usd);
  assert.equal(walletTokenMarkSummary([{provider_mark_value_usd:null}]).visible_provider_mark_value_usd,null);
  assert.equal(walletTokenMarkSummary([{provider_mark_value_usd:'0'}]).visible_priced_rows,1);
  assert.equal(applyWalletTokenMark({contract:Q},mark).provider_mark_price_usd,undefined);
});

test('Solana profile balance and metadata reads use Helius independently of public holder switches',async()=>{
  const calls=[],reads=createSolanaWalletProfileReads({HELIUS_API_KEY:'private-fixture',RAVENOS_PUBLIC_SOLANA_HOLDERS_ENABLED:'0',RAVENOS_HELIUS_WALLET_HISTORY_ENABLED:'0'}, {
    metadataCache:new Map(),rpc:async(url,method,params)=>{calls.push({url,method});
      assert.equal(new URL(url).hostname,'mainnet.helius-rpc.com');
      if(method==='getBalance')return {value:123456789,context:{slot:10}};
      if(method==='getTokenAccountsByOwner'){assert(WALLET_TOKEN_PROGRAMS.includes(params[1].programId));return {value:[],context:{slot:10}};}
      if(method==='getAssetBatch')return [];
      throw Error('unexpected RPC');
    }});
  const holdings=await reads.loadHoldings({address:SOL,now:NOW});await reads.loadTokenMetadata({mints:[USDC],now:NOW});
  assert.equal(holdings.native.amount_base_units,'123456789');assert.equal(holdings.state,'available');assert.equal(calls.length,4);
  assert(!JSON.stringify(holdings).includes('private-fixture'));assert.equal(reads.loadTokenMarks,undefined);
});
