import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeEvmWalletReceipt, evmSettlementBases, evmAnalyticalSettlementEvent, WALLET_SWAP_FACTORIES, WALLET_SWAP_TOPICS } from '../lib/customer_trade/evm_wallet_swaps.mjs';
import { applyEvmTradingRecord, EVM_WALLET_TRADING_PROFILE_VERSION } from '../lib/customer_trade/evm_wallet_trading_record.mjs';
import { walletUsdTradingRecord } from '../lib/customer_trade/wallet_historical_prices.mjs';

const NOW=Date.parse('2026-09-10T04:00:00Z');
const W='0x'+'11'.repeat(20), TOKEN='0x'+'22'.repeat(20), POOL='0x'+'33'.repeat(20), ROUTER='0x'+'44'.repeat(20);
const USDT='0xdac17f958d2ee523a2206206994597c13d831ec7', PEG='0x55d398326f99059ff775485246999027b3197955';
const word=n=>BigInt(n).toString(16).padStart(64,'0'), aw=a=>'0x'+a.slice(2).padStart(64,'0');
const hex=n=>'0x'+BigInt(n).toString(16);
function transfer(contract,from,to,value,index) {return {address:contract,logIndex:hex(index),topics:[WALLET_SWAP_TOPICS.transfer,aw(from),aw(to)],data:'0x'+word(value)};}
async function swap(chain,{sell=false,settlement,decimals,token=TOKEN,factory,reportedDecimals}={}) {
  settlement??=chain==='ethereum'?USDT:PEG; decimals??=chain==='ethereum'?6:18;
  factory??=WALLET_SWAP_FACTORIES[chain].v2[0];
  const consideration=(sell?75n:100n)*10n**BigInt(decimals), quantity=sell?5_000_000n:10_000_000n;
  const block=sell?102:101, transactionHash='0x'+word(block), blockHash='0x'+word(block+1000);
  const logs=sell?[transfer(token,W,POOL,quantity,0),transfer(settlement,POOL,W,consideration,1)]
    :[transfer(settlement,W,POOL,consideration,0),transfer(token,POOL,W,quantity,1)];
  logs.push({address:POOL,logIndex:'0x2',topics:[WALLET_SWAP_TOPICS.v2,aw(ROUTER),aw(W)],
    data:'0x'+(sell?[0n,quantity,consideration,0n]:[consideration,0n,0n,quantity]).map(word).join('')});
  const receipt={transactionHash,blockHash,blockNumber:hex(block),transactionIndex:'0x0',status:'0x1',logs,gasUsed:'0x5208',effectiveGasPrice:'0x1'};
  const rpc=async(method,[call])=>{
    assert.equal(method,'eth_call');
    if(call.to===POOL)return {'0x0dfe1681':aw(settlement),'0xd21220a7':aw(token),'0xc45a0155':aw(factory)}[call.data];
    assert.equal(call.to,factory); return aw(POOL);
  };
  return decodeEvmWalletReceipt({chain,wallet:W,receipt,transaction:{hash:transactionHash,blockHash,blockNumber:hex(block),from:W,to:ROUTER,value:'0x0'},
    time:new Date(NOW-(sell?60000:120000)).toISOString(),metadata:new Map([[settlement,{decimals:reportedDecimals??decimals,symbol:'USDT'}],[token,{decimals:6,symbol:'COIN'}]]),rpc,poolCache:new Map(),now:NOW});
}
function profile(chain,opening='0') {return {source_wallet:{chain,network:'mainnet',address:W},generated_at:new Date(NOW).toISOString(),
  positions:{provider_reported_token_balances:[{contract:TOKEN,decimals:6,balance_raw:'5000000',provider_mark_value_usd:'100'}]},
  wallet_reconstruction:{opening_balances:{[TOKEN]:opening}},coverage:{},behavior:{},source_performance:{},provider_activity:{},data_quality:{}};}
function analyze(chain,events,opening='0',prior=profile(chain,opening)) {return applyEvmTradingRecord(prior,events,{bases:evmSettlementBases(chain),openingBalances:opening===null?{}:{[TOKEN]:opening}});}

for(const [chain,key,contract,decimals] of [['ethereum','usdt',USDT,6],['bsc','binance_peg_usdt',PEG,18]]) {
  test(`${chain} exact USDT settlement supports partial FIFO closes without claiming USDC or USD equivalence`,async()=>{
    const events=[await swap(chain),await swap(chain,{sell:true})],before=JSON.stringify(events);
    assert.equal(events[0].classification.kind,'SWAP_BUY'); assert.equal(events[1].classification.kind,'SWAP_SELL');
    assert.deepEqual(events[0].wallet_accounting.trade.basis,evmSettlementBases(chain)[contract]);
    assert.equal(events[0].wallet_accounting.trade.basis.decimals,decimals);
    const result=analyze(chain,events), all=result.trading_record.periods.all_available;
    assert.equal(result.profile_version,EVM_WALLET_TRADING_PROFILE_VERSION);
    assert.equal(all.realized_pnl[key],'25'); assert.equal(all.realized_pnl[chain==='bsc'?'binance_peg_usdc':'usdc'],null);
    assert.equal(all.realized_pnl.usdc??null,null);
    assert.equal(all.buy_count,1); assert.equal(all.sell_count,1); assert.equal(all.fully_matched_sells,1);
    assert.equal(result.trading_record.tokens[0].by_basis[key].remaining_cost,'50');
    assert.equal(result.trading_record.tokens[0].unrealized_pnl_usd,null);
    const usd=walletUsdTradingRecord(result,events,[]);
    assert.equal(usd.eligible_trades,2); assert.equal(usd.priced_trades,0); assert.equal(usd.periods.all_available.realized_pnl.usd,null);
    assert.equal(analyze(chain,events,null).trading_record.periods.all_available.realized_pnl[key],null);
    assert.equal(JSON.stringify(events),before); assert.equal(events[0].copy_signal.eligible_buy_signal,false);
  });
  test(`${chain} retained version-102 verified swaps recover analytical direction without changing original events`,async()=>{
    const events=[await swap(chain),await swap(chain,{sell:true})].map(event=>({...event,decode_version:102,
      classification:{...event.classification,kind:'AMBIGUOUS',ambiguous:true},wallet_accounting:{...event.wallet_accounting,trade:null}}));
    const original=JSON.stringify(events), result=analyze(chain,events);
    assert.equal(result.behavior.buy_count,1); assert.equal(result.behavior.sell_count,1);
    assert.equal(result.trading_record.periods.all_available.realized_pnl[key],'25');
    assert.equal(result.behavior.first_trade_at,events[0].chain_evidence.block_time);
    assert.equal(JSON.stringify(events),original);
    assert.equal(evmAnalyticalSettlementEvent(events[0]).classification.kind,'AMBIGUOUS');
    assert.equal(evmAnalyticalSettlementEvent(events[0]).copy_signal.source_signal_ready,false);
  });
}

test('symbols, other-chain addresses, conflicting decimals and unreviewed pools cannot establish USDT basis',async()=>{
  assert.equal((await swap('ethereum',{settlement:PEG,decimals:18})).wallet_accounting.trade,null);
  assert.equal((await swap('bsc',{settlement:USDT,decimals:6})).wallet_accounting.trade,null);
  assert.equal((await swap('ethereum',{settlement:'0x'+'55'.repeat(20)})).wallet_accounting.trade,null);
  assert.equal((await swap('bsc',{reportedDecimals:6})).wallet_accounting.trade,null);
  assert.equal((await swap('ethereum',{factory:ROUTER})).wallet_accounting.trade,null);
});

test('retained analytical direction requires unchanged verified route, exact chain, finality and matching precision',async()=>{
  const valid=await swap('ethereum');
  const mutations=[
    e=>e.decode_version=101,
    e=>e.source_wallet.chain_id=56,
    e=>e.source_wallet.network='testnet',
    e=>e.chain_evidence.finality='pending',
    e=>e.classification.reasons=['no_verified_swap'],
    e=>e.wallet_accounting.route.factory=ROUTER,
    e=>e.wallet_accounting.movements[0].decimals=18,
    e=>e.wallet_accounting.movements[0].delta_raw='100000000',
    e=>e.wallet_accounting.movements.push({contract:ROUTER,delta_raw:'1',decimals:6}),
    e=>e.wallet_accounting.movements[1]=null,
  ];
  for(const mutate of mutations){const event=structuredClone(valid);mutate(event);assert.equal(evmAnalyticalSettlementEvent(event).wallet_accounting.trade,null);}
});

test('USDT settlement rotations clear obsolete token performance rather than preserving a false previous close',async()=>{
  const usdc=Object.values(evmSettlementBases('ethereum')).find(b=>b.key==='usdc');
  const rotation=await swap('ethereum',{token:usdc.contract});
  assert.equal(rotation.classification.kind,'AMBIGUOUS'); assert.equal(rotation.wallet_accounting.trade,null);
  rotation.decode_version=102; rotation.classification={...rotation.classification,kind:'SWAP_SELL',ambiguous:false};
  rotation.wallet_accounting.trade={kind:'SWAP_SELL',token:USDT,quantity:'100000000',decimals:6,basis:usdc,consideration:'10000000'};
  const prior={...profile('ethereum'),trading_record:{periods:{all_available:{realized_pnl:{usdc:'999'}}}}};
  const result=analyze('ethereum',[rotation],'0',prior);
  assert.equal(result.trading_record.periods.all_available.trade_count,0);
  assert.equal(result.trading_record.periods.all_available.realized_pnl.usdc,null);
  assert.equal(result.source_performance.closed_observations,0);
});

test('retained multi-pool settlement reuses verified graph evidence and rejects broken or cyclic paths',async()=>{
  const event=await swap('ethereum'), route=event.wallet_accounting.route;
  const middle='0x'+'66'.repeat(20), second='0x'+'77'.repeat(20);
  event.decode_version=102;event.classification={kind:'AMBIGUOUS',ambiguous:true,reasons:['verified_multi_pool_and_wallet_deltas']};
  event.wallet_accounting.trade=null;
  event.wallet_accounting.route={kind:'verified_multi_pool',pools:[
    {...route,token1:middle,input:USDT,output:middle},
    {...route,pool:second,token0:middle,input:middle,output:TOKEN},
  ]};
  assert.equal(evmAnalyticalSettlementEvent(event).wallet_accounting.trade.kind,'SWAP_BUY');
  const broken=structuredClone(event);broken.wallet_accounting.route.pools[1].input=TOKEN;
  assert.equal(evmAnalyticalSettlementEvent(broken).wallet_accounting.trade,null);
  const cyclic=structuredClone(event);cyclic.wallet_accounting.route.pools.push({...route,pool:'0x'+'88'.repeat(20),token0:TOKEN,token1:USDT,input:TOKEN,output:USDT});
  assert.equal(evmAnalyticalSettlementEvent(cyclic).wallet_accounting.trade,null);
});
