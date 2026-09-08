import test from 'node:test';
import assert from 'node:assert/strict';
import {routeCustomerWalletBalances,loadCustomerWalletBalance} from '../lib/customer_wallet_balances.mjs';
import {WALLET_TOKEN_PROGRAMS} from '../lib/customer_trade/solana_wallet_holdings.mjs';
const address='11111111111111111111111111111111',usdc='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const request=(query='')=>new Request('https://app.ravenos.xyz/api/v1/wallets/balances'+query);
function deps(user='owner') {return {authorize:async()=>({principal:{user_id:user}}),rateLimit:async()=>({allowed:true}),walletStore:{getIdentity:async()=>({state:'active'}),listWallets:async id=>id===user?[{ecosystem:'solana',state:'active',public_address:address}]:[]}};}
test('own wallet balance is authenticated, read-only and cannot request another wallet',async()=>{
 const denied=await routeCustomerWalletBalances(request(),{}, {authorize:async()=>({response:new Response('',{status:401})})});assert.equal(denied.status,401);
 let calls=0;const d={...deps(),loadBalance:async()=>{calls++;return{address,assets:[]};}};
 const wrong=await routeCustomerWalletBalances(request('?address=someone_else'),{},d);assert.equal(wrong.status,400);assert.equal(calls,0);
 const mutation=await routeCustomerWalletBalances(new Request(request().url,{method:'POST'}),{},d);assert.equal(mutation.status,405);
});
test('balance cache is separate per user, recent reads make no new RPC calls, no Pro or card needed',async()=>{
 let calls=0;const d={...deps('balance-cache-owner'),now:100000,loadBalance:async()=>{calls++;return{chain:'solana',address,assets:[{symbol:'SOL',amount:'1.230000000'}]};}};
 const first=await routeCustomerWalletBalances(request(),{},d);assert.match(first.headers.get('cache-control'),/no-store/);assert.equal((await first.json()).snapshot.assets[0].amount,'1.230000000');
 const second=await routeCustomerWalletBalances(request(),{}, {...d,now:120000});assert.equal((await second.json()).delivery,'recent_balance_cache');assert.equal(calls,1);
 const later=await routeCustomerWalletBalances(request(),{}, {...d,now:131000});assert.equal(later.status,200);assert.equal(calls,2);
 const other=await routeCustomerWalletBalances(request(),{}, {...deps('another-user'),walletStore:{getIdentity:async()=>null,listWallets:async()=>{throw Error('must not read');}}});assert.equal((await other.json()).state,'wallet_not_linked');
});
test('Solana balance preserves integer precision, canonical USDC and frozen token restrictions',async()=>{
 const methods=[];
 const fetchImpl=async(_url,init)=>{const q=JSON.parse(init.body);methods.push(q.method);let result;
 if(q.method==='getBalance')result={context:{slot:12},value:1234567890};
 else result={context:{slot:12},value:q.params[1].programId===WALLET_TOKEN_PROGRAMS[0]?['initialized','frozen'].map((state,i)=>({account:{owner:WALLET_TOKEN_PROGRAMS[0],data:{parsed:{info:{owner:address,mint:usdc,state,tokenAmount:{amount:i?'2000000':'83000001',decimals:6}}}}}})):[]};
 return Response.json({jsonrpc:'2.0',id:1,result});};
 const result=await loadCustomerWalletBalance({RAVENOS_SOLANA_RPC_URL:'https://mainnet.helius-rpc.com/?api-key=test'}, {public_address:address},'solana',{fetchImpl,now:100000});
 assert.equal(methods.length,3);assert.equal(result.assets[0].amount,'1.234567890');assert.equal(result.assets[1].amount,'85.000001');assert.equal(result.assets[1].spendable_before_network_fees,'83.000001');assert.equal(result.assets[1].canonical_usdc,true);assert.equal(result.execution_authority,false);
});
test('missing token balance is unknown, never zero; balance errors do not expose provider secrets',async()=>{
 const fetchImpl=async(_url,init)=>{const q=JSON.parse(init.body);if(q.method==='getBalance')return Response.json({id:1,result:{value:10000000,context:{slot:15}}});return Response.json({id:1,error:{message:'secret-url'}},{status:500});};
 const result=await loadCustomerWalletBalance({RAVENOS_SOLANA_RPC_URL:'https://mainnet.helius-rpc.com/?api-key=secret'}, {public_address:address},'solana',{fetchImpl});assert.equal(result.assets[0].amount,'0.010000000');assert.equal(result.assets[1].amount,null);assert.equal(result.state,'partial');
 const r=await routeCustomerWalletBalances(request(),{}, {...deps('failed-balance'),loadBalance:async()=>{throw Error('secret-url');}});assert.equal(r.status,503);assert.equal((await r.json()).error,'wallet_balance_unavailable');
});
