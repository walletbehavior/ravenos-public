import {encodeFunctionData,parseAbi} from 'viem';
import {verifiedDirectRouterNativeDelta,WALLET_NATIVE_ROUTERS} from '../lib/customer_trade/evm_wallet_native_router.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeEvmWalletReceipt, verifyWalletSwapPool, walletNativeDelta, WALLET_SWAP_FACTORIES, WALLET_SWAP_TOPICS, evmSettlementBases } from '../lib/customer_trade/evm_wallet_swaps.mjs';
import { buildEvmTradingRecord } from '../lib/customer_trade/evm_wallet_trading_record.mjs';
import { loadAlchemyTokenPrices, preciseTokenMark } from '../lib/customer_trade/alchemy_token_prices.mjs';
import { inspectEvmWallet } from '../lib/customer_trade/evm_wallet_lookup.mjs';
import { inspectRetainedEvmWallet } from '../lib/customer_trade/retained_evm_wallet.mjs';
import { createD1CustomerWalletCopyStore } from '../lib/customer_wallet_copy.mjs';
import { sqliteStore } from './customer_pro_rewards.test.mjs';

const W='0x'+'11'.repeat(20),T='0x'+'22'.repeat(20),P='0x'+'33'.repeat(20),R='0x'+'44'.repeat(20),U='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',F=WALLET_SWAP_FACTORIES.base.v2[0];
const NOW=Date.now(),iso=n=>new Date(n).toISOString(),hex=n=>'0x'+BigInt(n).toString(16),word=n=>BigInt(n).toString(16).padStart(64,'0'),aw=a=>'0x'+a.slice(2).padStart(64,'0');
const env={RAVENOS_EVM_WALLET_LOOKUP_ENABLED:'1',RAVENOS_ALCHEMY_WALLET_HISTORY_ENABLED:'1',RAVENOS_EVM_WALLET_RECONSTRUCTION_ENABLED:'1',ALCHEMY_BASE_RPC_URL:'https://base-mainnet.g.alchemy.com/v2/fixture-private-key'};
function transfer(contract,from,to,amount,index){return {address:contract,logIndex:hex(index),topics:[WALLET_SWAP_TOPICS.transfer,aw(from),aw(to)],data:'0x'+word(amount)};}
function receipt(sell=false){
 const hash='0x'+word(sell?2:1),blockHash='0x'+word(sell?102:101),blockNumber=hex(sell?102:101);
 const logs=sell?[transfer(T,W,P,5000000,0),transfer(U,P,W,75000000,1)]:[transfer(U,W,P,100000000,0),transfer(T,P,W,10000000,1)];
 logs.push({address:P,logIndex:'0x2',topics:[WALLET_SWAP_TOPICS.v2,aw(R),aw(W)],data:'0x'+(sell?[0,5000000,75000000,0]:[100000000,0,0,10000000]).map(word).join('')});
 return {transactionHash:hash,blockHash,blockNumber,transactionIndex:'0x0',status:'0x1',from:W,to:R,logs,gasUsed:'0x5208',effectiveGasPrice:'0x1'};
}
const transaction=r=>({hash:r.transactionHash,blockHash:r.blockHash,blockNumber:r.blockNumber,from:W,to:R,value:'0x0'});
async function poolRpc(method,params){
 assert.equal(method,'eth_call');const [call]=params;
 if(call.to===P)return ({'0x0dfe1681':aw(U),'0xd21220a7':aw(T),'0xc45a0155':aw(F),'0xddca3f43':'0x'+word(3000)})[call.data];
 if(call.to===F)return aw(P);
 throw Error('unexpected_pool_call');
}
async function decode(r,extra={}){return decodeEvmWalletReceipt({chain:'base',wallet:W,receipt:r,transaction:transaction(r),time:iso(NOW-(r.blockNumber==='0x65'?120000:60000)),metadata:new Map([[U,{decimals:6}],[T,{decimals:6}]]),rpc:poolRpc,poolCache:new Map(),now:NOW,...extra});}
function record(events,{opening='0',balance='5000000',price='100',...options}={}){return buildEvmTradingRecord(events,{bases:evmSettlementBases('base'),openingBalances:{[T]:opening},generatedAt:iso(NOW),balances:[{contract:T,decimals:6,balance_raw:balance,provider_mark_value_usd:price}],...options});}

test('verified single-pool receipts establish actual buys, sells and exact FIFO realized/unrealized results',async()=>{
 const buy=await decode(receipt()),sell=await decode(receipt(true));
 assert.equal(buy.classification.kind,'SWAP_BUY');assert.equal(sell.classification.kind,'SWAP_SELL');
 const result=record([sell,buy]),period=result.periods.d30,token=result.tokens[0];
 assert.equal(period.realized_pnl.usdc,'25');assert.equal(period.roi_pct,50);assert.equal(period.buy_count,1);assert.equal(period.sell_count,1);
 assert.equal(token.by_basis.usdc.remaining_cost,'50');assert.equal(token.unrealized_pnl_usd,'50');assert.equal(token.balance_reconciled,true);
 assert.equal(buy.copy_signal.eligible_buy_signal,false);assert.equal(result.network_fees_included,false);
});

test('arbitrary Swap topics and mismatched factory membership cannot establish trading profit',async()=>{
 const r=receipt();
 const foreign=await decode(r,{rpc:async(method,params)=>params[0].data==='0xc45a0155'?aw(R):poolRpc(method,params)});
 assert.equal(foreign.wallet_accounting.trade,null);
 const mismatch=await decode(r,{rpc:async(method,params)=>params[0].to===F?aw(R):poolRpc(method,params)});
 assert.equal(mismatch.wallet_accounting.trade,null);
});

test('pool evidence must agree with receipt transfers and connect the wallet to the pool',async()=>{
 const spoof=receipt();spoof.logs[2].data='0x'+[100000001,0,0,10000000].map(word).join('');
 assert.equal((await decode(spoof)).wallet_accounting.trade,null);
 const unrelated=receipt();unrelated.logs[0].topics[2]=aw('0x'+'77'.repeat(20));unrelated.logs[1].topics[1]=aw('0x'+'88'.repeat(20));unrelated.logs.unshift(transfer(U,R,P,100000000,3),transfer(T,P,R,10000000,4));
 assert.equal((await decode(unrelated)).wallet_accounting.trade,null);
 const split=receipt();split.logs.push({...split.logs[2],logIndex:'0x3'});assert.equal((await decode(split)).wallet_accounting.trade,null);
});

test('failed, mismatched, removed and malformed receipt evidence fails closed',async()=>{
 assert.equal(await decode({...receipt(),status:'0x0'}),null);
 const changed=receipt();changed.logs[0].removed=true;assert.equal(await decode(changed),null);
 const wrong=await decode(receipt(),{transaction:{...transaction(receipt()),blockHash:'0x'+word(999)}});assert.equal(wrong.wallet_accounting.trade,null);
 const bad=receipt();bad.logs[0].topics[1]='0x123';assert.equal(await decode(bad),null);
});

test('pool verification cache is scoped by chain and uses only a proven factory mapping',async()=>{
 const cache=new Map();let calls=0;const rpc=(m,p)=>{calls++;return poolRpc(m,p);};
 assert((await verifyWalletSwapPool({chain:'base',pool:P,kind:'v2',rpc,cache,now:NOW})).pool===P);
 await verifyWalletSwapPool({chain:'base',pool:P,kind:'v2',rpc,cache,now:NOW+100});assert.equal(calls,4);
 assert.equal(await verifyWalletSwapPool({chain:'ethereum',pool:P,kind:'v2',rpc,cache,now:NOW}),null);
});

test('transfers occupy unknown-cost FIFO lots and transfers out consume inventory',async()=>{
 const buy=await decode(receipt()),sell=await decode(receipt(true));
 const incoming={...buy,event_id:'incoming',chain_evidence:{...buy.chain_evidence,block_number:100},wallet_accounting:{version:1,movements:[{contract:T,decimals:6,delta_raw:'10000000'}],trade:null}};
 assert.equal(record([incoming,buy,sell],{balance:'15000000'}).periods.d30.realized_pnl.usdc,null);
 const outgoing={...buy,event_id:'outgoing',chain_evidence:{...buy.chain_evidence,transaction_index:1},wallet_accounting:{version:1,movements:[{contract:T,decimals:6,delta_raw:'-6000000'}],trade:null}};
 const result=record([buy,outgoing,sell],{balance:'0'});
 assert.equal(result.periods.d30.realized_pnl.usdc,'20');assert.equal(result.periods.d30.fully_matched_sells,0);
 assert.equal(result.tokens[0].unrealized_pnl_usd,null);
});

test('missing or nonzero starting inventory is never assumed to have zero cost',async()=>{
 const events=[await decode(receipt()),await decode(receipt(true))];
 for(const opening of [null,'100000000'])assert.equal(record(events,{opening}).periods.d30.realized_pnl.usdc,null);
 assert.equal(record(events,{balance:'9000000'}).tokens[0].unrealized_pnl_usd,null);
 assert.equal(record(events,{price:null}).tokens[0].unrealized_pnl_usd,null);
});

test('mixed settlement currencies do not become synthetic USDC returns',async()=>{
 const buy=await decode(receipt()),sell=await decode(receipt(true)),usdg={key:'usdg',label:'USDG',decimals:6};
 buy.wallet_accounting.trade.basis=usdg;sell.wallet_accounting.trade.basis=usdg;
 const result=record([buy,sell],{bases:{...evmSettlementBases('base'),alternate:usdg}});
 assert.equal(result.periods.d30.realized_pnl.usdc,null);assert.equal(result.periods.d30.realized_pnl.usdg,'25');assert.equal(result.tokens[0].unrealized_pnl_usd,null);
});

test('native value accounting excludes reverted subtrees and delegatecall phantom value',()=>{
 const tx={from:W,to:R,value:'0x64'},trace={type:'CALL',from:W,to:R,value:'0x64',calls:[{type:'CALL',from:R,to:W,value:'0xa'},{type:'CALL',from:R,to:W,value:'0xff',error:'reverted'},{type:'DELEGATECALL',from:W,to:R,value:'0xff'}]};
 assert.equal(walletNativeDelta(trace,W,tx),-90n);assert.equal(walletNativeDelta({...trace,from:R},W,tx),null);
 assert.equal(walletNativeDelta({...trace,calls:[{type:'INVALID'}]},W,tx),null);
});

test('token marks use integer multiplication, retain tiny prices and reject invalid precision',()=>{
 assert.equal(preciseTokenMark('9007199254740993000000',18,'0.0000025'),'0.022517');
 assert.equal(preciseTokenMark('5000000',6,'20'),'100');
 assert.equal(preciseTokenMark('1',255,'1'),null);
});

test('Alchemy prices validate exact network/address, USD currency and provider freshness, with shared-token cache',async()=>{
 let calls=0;const priceCache=new Map();
 const input={chain:'base',contracts:[T],rpcUrl:env.ALCHEMY_BASE_RPC_URL,now:NOW,priceCache,fetchImpl:async(url,init)=>{calls++;assert.equal(new URL(url).hostname,'api.g.alchemy.com');assert.equal(init.redirect,'manual');return Response.json({data:[{network:'base-mainnet',address:T,prices:[{currency:'usd',value:'20',lastUpdatedAt:iso(NOW-1000)}]}]});}};
 const first=await loadAlchemyTokenPrices(input);assert.equal(first.rows[0].price,'20');assert(!JSON.stringify(first).includes('private-key'));
 assert.equal((await loadAlchemyTokenPrices({...input,now:NOW+100})).request_count,0);assert.equal(calls,1);
 const stale=await loadAlchemyTokenPrices({...input,priceCache:new Map(),now:NOW+1000000});assert.equal(stale.rows.length,0);
 const other=await loadAlchemyTokenPrices({...input,priceCache:new Map(),fetchImpl:async()=>Response.json({data:[{network:'ethereum',address:T,prices:[]}]})});assert.equal(other.state,'unavailable');assert.equal(other.rows.length,0);
});

function provider() {
 const receipts=[receipt(),receipt(true)],calls=[];
 const entries=receipts.flatMap((r,ri)=>r.logs.slice(0,2).map((l,i)=>({hash:r.transactionHash,uniqueId:r.transactionHash+':'+i,blockNum:r.blockNumber,from:'0x'+l.topics[1].slice(-40),to:'0x'+l.topics[2].slice(-40),category:'erc20',rawContract:{address:l.address,value:l.data,decimal:'0x6'},metadata:{blockTimestamp:iso(NOW-(ri?60000:120000))}})));
 return {calls,fetchImpl:async(url,init)=>{
  if(url.includes('/prices/'))return Response.json({data:[{network:'base-mainnet',address:T,prices:[{currency:'usd',value:'20',lastUpdatedAt:iso(NOW)}]}]});
  const {method,params}=JSON.parse(init.body);calls.push(method);let result;
  if(method==='eth_chainId')result='0x2105';
  else if(method==='alchemy_getAssetTransfers')result={transfers:entries.filter(t=>params[0].fromAddress?t.from===W:t.to===W),pageKey:null};
  else if(method==='alchemy_getTokenBalances')result={address:W,tokenBalances:[{contractAddress:T,tokenBalance:hex(5000000)}]};
  else if(method==='eth_getBalance')result='0x0';
  else if(method==='alchemy_getTokenMetadata')result={symbol:params[0]===U?'USDC':'TEST',decimals:6};
  else if(method==='eth_getTransactionReceipt')result=receipts.find(r=>r.transactionHash===params[0]);
  else if(method==='eth_getTransactionByHash')result=transaction(receipts.find(r=>r.transactionHash===params[0]));
  else if(method==='eth_call'&&params[0].data.startsWith('0x70a08231'))result='0x'+word(0);
  else result=await poolRpc(method,params);
  return Response.json({jsonrpc:'2.0',id:1,result});
 }};
}

test('the real Alchemy loader/decoder/profile pipeline produces exact P&L without another provider or execution',async()=>{
 const p=provider();const result=await inspectEvmWallet({chain:'base',address:W,env,fetchImpl:p.fetchImpl,now:iso(NOW)});
 assert.equal(result.profile.trading_record.periods.d30.realized_pnl.usdc,'25');
 assert.equal(result.profile.trading_record.tokens[0].unrealized_pnl_usd,'50');
 assert.equal(result.profile.provider_activity.raven_decoded_trade_transactions,2);
 assert.equal(result.profile.evidence_boundary.copy_signal_created,false);
 assert(p.calls.length<40);assert(!JSON.stringify(result).includes('fixture-private-key'));
});

test('durable reconstruction reopens without RPCs and preserves the complete accounting record',async()=>{
 const db=sqliteStore(),store=createD1CustomerWalletCopyStore(db),p=provider();
 const input={chain:'base',address:W,env,fetchImpl:p.fetchImpl,now:iso(NOW)},now=Math.floor(NOW/1000);
 const first=await inspectRetainedEvmWallet(input,{db,store,now});const count=p.calls.length;
 const second=await inspectRetainedEvmWallet(input,{db,store,now:now+1});
 assert.equal(p.calls.length,count);assert.equal(second.provider_request_performed,false);
 assert.deepEqual(second.profile.trading_record,first.profile.trading_record);
 assert.equal(db.raw.prepare('PRAGMA foreign_key_check').all().length,0);db.raw.close();
});

test('V3 signed pool deltas and factory fee-tier membership establish a swap',async()=>{
 const r=receipt(),factory=WALLET_SWAP_FACTORIES.base.v3[0];
 r.logs[2]={...r.logs[2],topics:[WALLET_SWAP_TOPICS.v3,aw(R),aw(W)],data:'0x'+[100000000n,2n**256n-10000000n,1n,1n,0n].map(word).join('')};
 const rpc=async(method,params)=>params[0].data==='0xc45a0155'?aw(factory):params[0].to===factory?aw(P):poolRpc(method,params);
 assert.equal((await decode(r,{rpc})).classification.kind,'SWAP_BUY');
 r.logs[2].data='0x'+[100000000n,10000000n,1n,1n,0n].map(word).join('');
 assert.equal((await decode(r,{rpc})).wallet_accounting.trade,null);
});

test('native swap requires the full wallet value trace, including refunds',async()=>{
 const wrapped=Object.values(evmSettlementBases('base')).find(b=>b.key==='weth').contract,r=receipt();
 r.logs[0]=transfer(wrapped,R,P,90,0);
 r.logs[2].data='0x'+[90,0,0,10000000].map(word).join('');
 const tx={...transaction(r),value:'0x64'},trace={type:'CALL',from:W,to:R,value:'0x64',calls:[{type:'CALL',from:R,to:W,value:'0xa'}]};
 const rpc=async(method,params)=>method==='debug_traceTransaction'?trace:params[0].data==='0x0dfe1681'?aw(wrapped):poolRpc(method,params);
 const result=await decode(r,{transaction:tx,rpc});
 assert.equal(result.classification.kind,'SWAP_BUY');assert.equal(result.wallet_accounting.trade.basis.key,'eth');assert.equal(result.wallet_accounting.trade.consideration,'90');
 assert.equal((await decode(r,{transaction:tx,rpc:async(method,params)=>{if(method==='debug_traceTransaction')throw Error('unsupported');return rpc(method,params);}})).wallet_accounting.trade,null);
});

test('mismatched settlement precision and inconsistent token precision never create P&L',async()=>{
 const invalid=await decode(receipt(),{metadata:new Map([[U,{decimals:18}],[T,{decimals:6}]])});
 assert.equal(invalid.wallet_accounting.trade,null);
 const buy=await decode(receipt()),sell=await decode(receipt(true));sell.wallet_accounting.movements.find(m=>m.contract===T).decimals=18;
 const result=record([buy,sell]);assert.equal(result.periods.d30.realized_pnl.usdc,null);assert.equal(result.invalid_precision_tokens,1);
 assert.equal(await decode({...receipt(),blockNumber:'bad'}),null);
});

test('a valid prefix in an invalid price batch cannot poison the shared cache',async()=>{
 const priceCache=new Map();
 const result=await loadAlchemyTokenPrices({chain:'base',contracts:[T,U],rpcUrl:env.ALCHEMY_BASE_RPC_URL,priceCache,now:NOW,fetchImpl:async()=>Response.json({data:[{network:'base-mainnet',address:T,prices:[{currency:'usd',value:'20',lastUpdatedAt:iso(NOW)}]},{network:'wrong-chain',address:U,prices:[]}]})});
 assert.equal(result.state,'unavailable');assert.deepEqual(result.rows,[]);assert.equal(priceCache.size,0);
});

test('overlapping verified receipts merge idempotently; gaps never reuse old opening costs',async()=>{
 const p=provider(),input={chain:'base',address:W,env,fetchImpl:p.fetchImpl,now:iso(NOW)};
 const first=await inspectEvmWallet(input),prior={...first.profile.wallet_reconstruction,events:first.retained_accounting_events};
 const repeated=await inspectEvmWallet({...input,priorAnalysis:prior});
 assert.equal(repeated.retained_accounting_events.length,2);assert.equal(repeated.profile.trading_record.periods.d30.realized_pnl.usdc,'25');
 const unrelated={...prior,events:prior.events.map(e=>({...e,chain_evidence:{...e.chain_evidence,transaction_reference:'0x'+word(999)}})),opening_balances:{[T]:'999999999'}};
 const fresh=await inspectEvmWallet({...input,priorAnalysis:unrelated});
 assert.equal(fresh.profile.wallet_reconstruction.opening_balances[T],'0');assert.equal(fresh.profile.trading_record.periods.d30.realized_pnl.usdc,'25');
});

test('a truncated transfer page at the accounting boundary cannot claim complete inventory',async()=>{
 const p=provider(),fetchImpl=async(url,init)=>{
   const response=await p.fetchImpl(url,init);if(url.includes('/prices/'))return response;
   const body=JSON.parse(init.body);if(body.method!=='alchemy_getAssetTransfers')return response;
   const value=await response.json();value.result.pageKey='more';return Response.json(value);
 };
 const result=await inspectEvmWallet({chain:'base',address:W,env,fetchImpl,now:iso(NOW)});
 assert.equal(result.profile.wallet_reconstruction.window_complete,false);
 assert.equal(result.profile.trading_record.periods.d30.realized_pnl.usdc,null);
});

test('rollout flag off leaves the prior transfer-only path without pool, trace or price calls',async()=>{
 const p=provider(),result=await inspectEvmWallet({chain:'base',address:W,env:{...env,RAVENOS_EVM_WALLET_RECONSTRUCTION_ENABLED:'0'},fetchImpl:p.fetchImpl,now:iso(NOW)});
 assert.equal(result.profile.trading_record,undefined);assert.equal(p.calls.includes('debug_traceTransaction'),false);assert.equal(p.calls.includes('eth_call'),false);
});


test('direct native router fallback verifies method, recipient, wrapped asset and an EOA',async()=>{
 const router=WALLET_NATIVE_ROUTERS.base,wrapped=Object.values(evmSettlementBases('base')).find(b=>b.key==='weth').contract;
 const abi=parseAbi(['function swapExactETHForTokens(uint256,address[],address,uint256) payable returns (uint256[])']);
 const transaction={from:W,to:router,value:'0x64',input:encodeFunctionData({abi,functionName:'swapExactETHForTokens',args:[0n,[wrapped,T],W,9999999999n]})};
 const {keccak256,toHex}=await import('viem');
 const receipt={blockNumber:'0x65',logs:[{address:wrapped,topics:[keccak256(toHex('Deposit(address,uint256)')),aw(router)],data:'0x'+word(100)}]};
 const input={chain:'base',wallet:W,transaction,receipt,wrapped,route:{kind:'v2',token0:wrapped,token1:T,factory:F},rpc:async(method,params)=>method==='eth_getCode'?'0x':params[0].data==='0xc45a0155'?aw(F):aw(wrapped)};
 assert.equal(await verifiedDirectRouterNativeDelta(input),-100n);
 assert.equal(await verifiedDirectRouterNativeDelta({...input,transaction:{...transaction,to:R}}),null);
 assert.equal(await verifiedDirectRouterNativeDelta({...input,rpc:async(method,params)=>method==='eth_getCode'?'0xef0100':input.rpc(method,params)}),null);
 assert.equal(await verifiedDirectRouterNativeDelta({...input,transaction:{...transaction,value:'0x65'}}),null);
 assert.equal(await verifiedDirectRouterNativeDelta({...input,transaction:{...transaction,input:encodeFunctionData({abi,functionName:'swapExactETHForTokens',args:[0n,[wrapped,T],R,9999999999n]})}}),null);
});

test('real Robinhood Router02 receipt reconstructs native input through the canonical wrapper mint event',async()=>{
 const {readFileSync}=await import('node:fs'),fixture=JSON.parse(readFileSync(new URL('./fixtures/wallet-reconstruction/robinhood-direct-native-buy.json',import.meta.url)));
 const router=WALLET_NATIVE_ROUTERS.robinhood,wrapped='0x0bd7d308f8e1639fab988df18a8011f41eacad73',token='0xc70d422c1fbfefc0534dd9cc81737888bda20009',pool='0xc55d059c0272ef8c4019fa7e9909beae498a7b6c',factory=WALLET_SWAP_FACTORIES.robinhood.v2[0];
 const rpc=async(method,params)=>{
   if(method==='eth_getCode')return '0x';
   assert.equal(method,'eth_call');const call=params[0];
   if(call.to===factory)return aw(pool);
   return {'0x0dfe1681':aw(wrapped),'0xd21220a7':aw(token),'0xc45a0155':aw(factory),'0xad5c4648':aw(wrapped)}[call.data];
 };
 const input={chain:'robinhood',wallet:fixture.transaction.from,...fixture,metadata:new Map(fixture.metadata),now:Date.parse(fixture.time)+1000,poolCache:new Map(),rpc};
 const result=await decodeEvmWalletReceipt(input);
 assert.equal(result.classification.kind,'SWAP_BUY');assert.equal(result.wallet_accounting.native_evidence,'verified_direct_router_receipt');
 assert.equal(result.wallet_accounting.trade.basis.key,'eth');assert.equal(result.wallet_accounting.trade.consideration,BigInt(fixture.transaction.value).toString());
 assert.equal(result.wallet_accounting.trade.quantity,'287179811480931');assert.equal(result.wallet_accounting.trade.decimals,9);
 const missing=structuredClone(fixture.receipt);missing.logs=missing.logs.filter(log=>log.topics[1]!=='0x'+'0'.repeat(64));
 assert.equal((await decodeEvmWalletReceipt({...input,receipt:missing})).wallet_accounting.trade,null);
});
