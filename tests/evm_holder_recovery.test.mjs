import test from 'node:test';
import assert from 'node:assert/strict';
import { loadObservedEvmHolderInputs } from '../lib/customer_trade/evm_observed_holders.mjs';
import { buildPublicEvmHolderProjection } from '../lib/onchain_evm_holder_projection.mjs';
import { observedMarketWallets } from '../lib/customer_trade/market_wallet_index.mjs';
import { buildMarketControlRiskProjection } from '../lib/market_control_risk.mjs';
import { sqliteStore } from './customer_pro_rewards.test.mjs';
import { createD1CustomerWalletCopyStore } from '../lib/customer_wallet_copy.mjs';
import { normalizeSourceWalletChainIdentity } from '../lib/customer_trade/source_wallet_chain_identity.mjs';
import { observedWalletMarketEvidence, retainWalletMarketEvidence } from '../lib/customer_trade/wallet_market_evidence.mjs';

const NOW=Date.parse('2026-09-08T12:00:00Z'),A=n=>'0x'+BigInt(n).toString(16).padStart(40,'0'),H=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),X=n=>'0x'+BigInt(n).toString(16);
const W=A(91),S=A(92),TOKEN=A(93),POOL=A(94),QUOTE=A(95);
const ids={robinhood:4663,base:8453,ethereum:1,bsc:56},hosts={robinhood:'robinhood-mainnet',base:'base-mainnet',ethereum:'eth-mainnet',bsc:'bnb-mainnet'};
const identity=chain=>({chain,pool_address:POOL,token_address:TOKEN,quote_token_address:QUOTE});
const env=chain=>({RAVENOS_ALCHEMY_WALLET_HISTORY_ENABLED:'1',RAVENOS_PUBLIC_EVM_HOLDERS_ENABLED:'1',BLOCKSCOUT_API_KEY:'proapi_test_secret', [`ALCHEMY_${chain==='ethereum'?'ETH':chain.toUpperCase()}_RPC_URL`]:`https://${hosts[chain]}.g.alchemy.com/v2/test_secret`});
function provider(chain,{wrongChain=false,reorg=false,wrongToken=false,zero=false,failedCode=false}={}){
 const calls=[];let blockReads=0;
 return {calls,async fetchImpl(url,options){
  const req=JSON.parse(options.body);calls.push(req);const {method,params}=req;let result;
  if(method==='eth_chainId')result=X(wrongChain?999:ids[chain]);
  else if(method==='eth_blockNumber')result=X(1000);
  else if(method==='eth_getBlockByNumber')result={number:X(936),hash:H(reorg&&++blockReads>1?4:3),timestamp:X(NOW/1000-64)};
  else if(method==='alchemy_getAssetTransfers'){
   assert.deepEqual(params[0].contractAddresses,[TOKEN]);assert.equal(params[0].toBlock,X(936));assert.equal(params[0].maxCount,'0x14');
   result={transfers:[{hash:H(2),blockNum:X(900),from:S,to:W,category:'erc20',rawContract:{address:wrongToken?QUOTE:TOKEN}}]};
  }else if(method==='eth_call'){
   assert.equal(params[0].to,TOKEN);assert.equal(params[1],X(936));
   result=params[0].data==='0x313ce567'?H(6):params[0].data==='0x18160ddd'?H(100000000):H(zero?0:10000000);
  }else if(method==='eth_getCode'){
   assert.equal(params[1],X(936));result=failedCode?null:params[0]===W?'0x':'0x6000';
  }else throw Error('non_read_or_unexpected_method');
  return Response.json({id:1,result});
 }};
}
for(const chain of Object.keys(ids))test(`${chain} fallback exposes verified sampled owners without inventing top-holder metrics`,async()=>{
 const p=provider(chain),configured=env(chain),seen=[];
 const snapshot=await buildPublicEvmHolderProjection({env:configured,identity:identity(chain),now:()=>new Date(NOW),fetch_impl:async(url,options)=>{
  seen.push(String(url));
  if(options.method==='GET')return new Response('<html>Unavailable</html>',{status:503});
  return p.fetchImpl(url,options);
 }});
 assert.equal(snapshot.holders.length,2);assert.equal(snapshot.coverage.scope,'observed_wallet_balances');
 assert.equal(snapshot.summary.holder_count,null);assert.equal(snapshot.summary.top_10_wallet_supply_pct,null);assert.equal(snapshot.summary.largest_non_pool_wallet_supply_pct,null);
 assert.equal(snapshot.holders.find(row=>row.holder_address===W).classification,'owner');
 assert.equal(snapshot.holders.find(row=>row.holder_address===S).classification,'contract');
 assert.equal(snapshot.source.provider_path,'alchemy_observed_balances');assert(!JSON.stringify(snapshot).includes('test_secret'));
 assert(snapshot.coverage.balance_evidence.request_count<=48);
 assert(seen.every(url=>!url.includes('blockscout.com/api/v2')||!url.includes('apikey=')));
 const wallets=observedMarketWallets(snapshot,{now:NOW/1000});assert.equal(wallets.length,1);assert.equal(wallets[0].discovery_source,undefined);
 const risk=buildMarketControlRiskProjection({identity:identity(chain),holder_projection:snapshot,observed_at:snapshot.observed_at});
 assert.equal(risk.metrics.largest_non_pool_wallet_supply_pct,null);
 assert(!risk.risk_factors.some(row=>/wallet.*concentration|single_holder/.test(row.id)));
 const count=seen.length;
 const cached=await buildPublicEvmHolderProjection({env:configured,identity:identity(chain),now:()=>new Date(NOW),fetch_impl:()=>{throw Error('cache_should_be_used');}});
 assert.equal(cached.cache,'hit');assert.equal(seen.length,count);
});

test('retained exact-market candidates avoid a fresh token-index request and never mix chains or tokens',async()=>{
 const db=sqliteStore(),store=createD1CustomerWalletCopyStore(db),chain='robinhood';
 for(const [scope,token,wallet] of [[chain,TOKEN,W],[chain,QUOTE,A(99)],['base',TOKEN,A(98)]]){
  const id=normalizeSourceWalletChainIdentity({chain:scope,network:'mainnet',address:wallet});
  await store.upsertSourceWallet({...id,now:NOW/1000,state:'requested',provider_scope:'public_market_sample'});
  const projection={ok:true,safe_public:true,schema_version:'ravenos.onchain_pool_trades.v1',identity:{...identity(scope),token_address:token,quote_token_address:token===QUOTE?TOKEN:QUOTE},observed_at:new Date(NOW).toISOString(),trades:[{trader_address:wallet,transaction_hash:H(5),observed_at:new Date(NOW).toISOString(),side:'buy',volume_usd:'10'}]};
  await retainWalletMarketEvidence(db,observedWalletMarketEvidence(projection,{now:NOW/1000,admitted_wallets:[id]}));
 }
 const p=provider(chain),result=await loadObservedEvmHolderInputs({env:{...env(chain),RAVENOS_CUSTOMER_DB:db},identity:identity(chain),now:NOW,fetchImpl:p.fetchImpl});
 assert.equal(result.evidence.candidate_source,'raven_retained_exact_market');assert.equal(result.holderPayload.items.length,1);
 assert.equal(result.holderPayload.items[0].address.hash,W);assert(!p.calls.some(c=>c.method==='alchemy_getAssetTransfers'));
 db.raw.close();
});

for(const [options,code] of [[{wrongChain:true},'chain_mismatch'],[{reorg:true},'reorg'],[{wrongToken:true},'index_identity_mismatch'],[{zero:true},'balances_unavailable'],[{failedCode:true},'balances_unavailable']])test(`observed holder fallback fails closed on ${code}`,async()=>{
 const p=provider('robinhood',options);
 await assert.rejects(loadObservedEvmHolderInputs({env:env('robinhood'),identity:identity('robinhood'),fetchImpl:p.fetchImpl,now:NOW}),new RegExp(code));
});

test('official chain-instance fallback retains top-holder scope without forwarding the Pro API key',async()=>{
 const id={...identity('base'),token_address:A(101)};let calls=0;
 const p=await buildPublicEvmHolderProjection({env:env('base'),identity:id,now:()=>new Date(NOW),fetch_impl:async(url,options)=>{
  calls++;const u=new URL(String(url));assert.equal(options.redirect,'manual');
  if(u.hostname==='api.blockscout.com')return new Response('upstream unavailable',{status:502});
  assert.equal(u.origin,'https://base.blockscout.com');assert.equal(u.search,'');assert(!JSON.stringify(options.headers).includes('test_secret'));
  return Response.json(u.pathname.endsWith('/holders')?{items:[{value:'10',address:{hash:W,is_contract:false}}]}:{address_hash:id.token_address,type:'ERC-20',decimals:'0',total_supply:'100',holders_count:'5'});
 }});
 assert.equal(calls,4);assert.equal(p.source.provider_path,'blockscout_chain_instance');assert.equal(p.summary.holder_count,5);
 assert.equal(p.coverage.scope,'provider_ranked_top_holders');
});

test('successful wrong-token or missing-precision payload is rejected without fallback',async()=>{
 for(const missing of [false,true]){
  const id={...identity('bsc'),token_address:A(missing?104:103)};let count=0;
  await assert.rejects(buildPublicEvmHolderProjection({env:env('bsc'),identity:id,fetch_impl:async(url)=>{
   count++;return Response.json(String(url).includes('/holders')?{items:[]}:{address_hash:missing?id.token_address:TOKEN,type:'ERC-20',decimals:missing?null:6,total_supply:'100'});
  }}),new RegExp(missing?'supply_unavailable':'identity_mismatch'));
  assert.equal(count,2);
 }
});

test('a holder outage cannot mask a simultaneously mismatched token response',async()=>{
 const id={...identity('base'),token_address:A(105)};let calls=0;
 await assert.rejects(buildPublicEvmHolderProjection({env:env('base'),identity:id,fetch_impl:async(url)=>{
  calls++;assert.equal(new URL(String(url)).hostname,'api.blockscout.com');
  return new URL(String(url)).pathname.endsWith('/holders')
    ? new Response('unavailable',{status:503})
    : Response.json({address_hash:TOKEN,type:'ERC-20',decimals:'6',total_supply:'1000'});
 }}),/identity_mismatch/);
 assert.equal(calls,2);
});
