import {verifiedDirectRouterNativeDelta} from './evm_wallet_native_router.mjs';
import { createHash } from 'node:crypto';
import { keccak256, toHex } from 'viem';
import { resolveEvmChainProfile } from './evm_chain_profiles.mjs';

// Reviewed protocol deployments; pool membership is verified against the
// factory, not accepted from an arbitrary contract emitting a Swap topic.
export const WALLET_SWAP_FACTORIES = Object.freeze({
  ethereum: { v2:['0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f','0x1097053fd2ea711dad45caccc45eff7548fcb362'], v3:['0x1f98431c8ad98523631ae4a59f267346ea31f984'] },
  base: { v2:['0x8909dc15e40173ff4699343b6eb8132c65e18ec6','0x02a84c1b3bbd7401a5f7fa98a384ebc70bb5749e'], v3:['0x33128a8fc17869897dce68ed026d694621f6fdfd'] },
  bsc: { v2:['0x8909dc15e40173ff4699343b6eb8132c65e18ec6','0xca143ce32fe78f1f7019d7d551a6402fc5350c73'], v3:['0xdb1d10011ad0ff90774d0c6bb92e5c5c8b4461f7'] },
  robinhood: { v2:['0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f','0x02a84c1b3bbd7401a5f7fa98a384ebc70bb5749e'], v3:['0x1f7d7550b1b028f7571e69a784071f0205fd2efa'] },
});
export const WALLET_SWAP_TOPICS = Object.freeze({
  transfer:keccak256(toHex('Transfer(address,address,uint256)')),
  v2:keccak256(toHex('Swap(address,uint256,uint256,uint256,uint256,address)')),
  v3:keccak256(toHex('Swap(address,address,int256,int256,uint160,uint128,int24)')),
});
const address=v=>/^0x[0-9a-f]{40}$/i.test(v||'') ? v.toLowerCase() : null;
const hash=v=>/^0x[0-9a-f]{64}$/i.test(v||'') ? v.toLowerCase() : null;
const quantity=v=>/^0x[0-9a-f]{1,64}$/i.test(v||'') ? BigInt(v) : null;
const word=v=>/^0x[0-9a-f]{64}$/i.test(v||'') ? v.toLowerCase() : null;
const addressWord=v=>/^0x0{24}[0-9a-f]{40}$/i.test(v||'') ? address('0x'+v.slice(-40)) : null;
const selector=s=>keccak256(toHex(s)).slice(0,10);
const param=a=>a.slice(2).padStart(64,'0');
const publicPools = new Map();
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,40);

export function evmSettlementBases(chain) {
  const p=resolveEvmChainProfile(chain), a=p.accounting_asset;
  return {
    [a.address.toLowerCase()]:{key:a.circle_canonical_usdc?'usdc':chain==='robinhood'?'usdg':'binance_peg_usdc',label:a.circle_canonical_usdc?'USDC':chain==='robinhood'?'USDG':'USDC (Binance-Peg)',decimals:a.decimals,contract:a.address.toLowerCase()},
    [p.wrapped_native_token_address]:{key:chain==='bsc'?'wbnb':'weth',label:chain==='bsc'?'WBNB':'WETH',decimals:18,contract:p.wrapped_native_token_address},
    native:{key:p.native_symbol.toLowerCase(),label:p.native_symbol,decimals:18,contract:'native'},
  };
}

export async function verifyWalletSwapPool({chain,pool,kind,rpc,block='latest',now=Date.now(),cache=publicPools}) {
  pool=address(pool); if(!pool||!WALLET_SWAP_FACTORIES[chain]?.[kind])return null;
  const key=`${chain}:${kind}:${pool}`, cached=cache.get(key);
  if(cached && cached.expires>now)return cached.value;
  try {
    const call=(to,data)=>rpc('eth_call',[{to,data},block]);
    const [a,b,f]=await Promise.all(['token0()','token1()','factory()'].map(s=>call(pool,selector(s))));
    const token0=addressWord(a),token1=addressWord(b),factory=addressWord(f);
    if(!token0||!token1||token0===token1||!WALLET_SWAP_FACTORIES[chain][kind].includes(factory))return null;
    let fee=null, data=selector('getPair(address,address)')+param(token0)+param(token1);
    if(kind==='v3') {
      const raw=await call(pool,selector('fee()'));
      if(!word(raw)||BigInt(raw)>1000000n)return null;
      fee=Number(BigInt(raw)); data=selector('getPool(address,address,uint24)')+param(token0)+param(token1)+BigInt(fee).toString(16).padStart(64,'0');
    }
    if(addressWord(await call(factory,data))!==pool)return null;
    const value={pool,token0,token1,factory,kind,fee};
    while(cache.size>=512)cache.delete(cache.keys().next().value);
    // Reviewed factories deploy immutable pools; cache public identity only.
    cache.set(key,{value,expires:now+3600000});return value;
  } catch {return null;}
}

function transferDeltas(receipt,wallet) {
  const deltas=new Map(), all=[]; const indices=new Set();
  for(const log of receipt.logs) {
    if(log.removed || (log.transactionHash && hash(log.transactionHash)!==hash(receipt.transactionHash)) || (log.blockHash && hash(log.blockHash)!==hash(receipt.blockHash)))throw Error('receipt_log_identity_mismatch');
    if(log.topics?.[0]?.toLowerCase()!==WALLET_SWAP_TOPICS.transfer)continue;
    if(log.topics.length!==3||!word(log.data)||!address(log.address))throw Error('receipt_transfer_invalid');
    const from=addressWord(log.topics[1]),to=addressWord(log.topics[2]);
    if(!from||!to||!/^0x[0-9a-f]+$/i.test(log.logIndex||'')||indices.has(log.logIndex))throw Error('receipt_transfer_invalid');
    indices.add(log.logIndex);
    const contract=address(log.address),amount=BigInt(log.data);
    all.push({contract,from,to,amount});
    if(from===wallet)deltas.set(contract,(deltas.get(contract)||0n)-amount);
    if(to===wallet)deltas.set(contract,(deltas.get(contract)||0n)+amount);
  }
  return {deltas,all};
}

// Native consideration is admitted only with a complete successful call tree.
// Delegate/static frames do not transfer ETH; reverted subtrees have no effect.
export function walletNativeDelta(trace,wallet,transaction) {
  if(!trace||trace.error||address(trace.from)!==wallet||address(trace.to)!==address(transaction.to)
    || String(trace.value||'0x0').toLowerCase()!==String(transaction.value||'0x0').toLowerCase())return null;
  let delta=0n,count=0;
  const visit=(node,depth=0)=>{
    if(++count>2000||depth>64)throw Error('trace_limit');
    if(node.error)return;
    const type=String(node.type||'').toUpperCase();
    if(!['CALL','STATICCALL','DELEGATECALL','CALLCODE','CREATE','CREATE2','SELFDESTRUCT'].includes(type))throw Error('trace_type');
    if(['CALL','CREATE','CREATE2','SELFDESTRUCT'].includes(type)) {
      if(!/^0x[0-9a-f]+$/i.test(node.value||'0x0'))throw Error('trace_value');
      const value=BigInt(node.value||'0x0');
      if(address(node.from)===wallet)delta-=value;
      if(address(node.to)===wallet)delta+=value;
    }
    if(node.calls!==undefined&&!Array.isArray(node.calls))throw Error('trace_calls');
    for(const child of node.calls||[])visit(child,depth+1);
  };
  try {visit(trace);return delta;}catch{return null;}
}

export async function decodeEvmWalletReceipt({chain,wallet,receipt,transaction,time,metadata,rpc,poolCache,now=Date.now(),provider='alchemy_wallet_receipts'}) {
  wallet=address(wallet); const p=resolveEvmChainProfile(chain);
  const reference=hash(receipt?.transactionHash),blockHash=hash(receipt?.blockHash);
  const block=quantity(receipt?.blockNumber),index=quantity(receipt?.transactionIndex);
  if(!wallet||!reference||!blockHash||receipt.status!=='0x1'||!Array.isArray(receipt.logs)||receipt.logs.length>500||block===null||index===null||!Number.isSafeInteger(Number(block))||!Number.isSafeInteger(Number(index)))return null;
  const at=Date.parse(time); if(!Number.isFinite(at)||at>now+60000)return null;
  let transfers;try{transfers=transferDeltas(receipt,wallet);}catch{return null;}
  const movements=[...transfers.deltas].filter(([,v])=>v!==0n).map(([contract,delta])=>({contract,delta_raw:delta.toString(),decimals:metadata.get(contract)?.decimals??null}));
  if(movements.length>64)return null;
  const swaps=receipt.logs.filter(log=>Object.values(WALLET_SWAP_TOPICS).slice(1).includes(log.topics?.[0]?.toLowerCase()));
  let route=null,reason='no_verified_swap',native=null,nativeEvidence=null;
  // One verified pool and exactly two wallet economic legs are conservative
  // first support. Split/multihop/LP/zap transactions remain unresolved.
  if(swaps.length===1 && swaps[0].topics?.length===3 && address(transaction?.from)===wallet && hash(transaction?.hash)===reference && hash(transaction?.blockHash)===blockHash && transaction?.blockNumber===receipt.blockNumber) {
    const log=swaps[0],kind=log.topics[0].toLowerCase()===WALLET_SWAP_TOPICS.v2?'v2':'v3';
    const words=(log.data||'').slice(2).match(/.{64}/g)||[];
    const validData=/^0x[0-9a-f]+$/i.test(log.data||'') && words.length===(kind==='v2'?4:5) && log.data.length===2+words.length*64;
    if(validData)route=await verifyWalletSwapPool({chain,pool:log.address,kind,rpc,block:receipt.blockNumber,cache:poolCache,now});
    if(route) {
      if(movements.length===1 && [route.token0,route.token1].includes(p.wrapped_native_token_address)) {
        native=await verifiedDirectRouterNativeDelta({chain,wallet,transaction,receipt,route,wrapped:p.wrapped_native_token_address,rpc});
        if(native!==null)nativeEvidence='verified_direct_router_receipt';
        else {
          try {native=walletNativeDelta(await rpc('debug_traceTransaction',[reference,{tracer:'callTracer',timeout:'3s',tracerConfig:{onlyTopCall:false}}]),wallet,transaction);}catch{native=null;}
          if(native!==null)nativeEvidence='complete_wallet_call_trace';
        }
        if(native===null)reason='native_value_evidence_unavailable';
        if(native!==null&&native!==0n)movements.push({contract:'native',delta_raw:native.toString(),decimals:18});
      }
      const negatives=movements.filter(m=>BigInt(m.delta_raw)<0n),positives=movements.filter(m=>BigInt(m.delta_raw)>0n);
      const poolContract=m=>m.contract==='native'?p.wrapped_native_token_address:m.contract;
      const correctLegs=negatives.length===1&&positives.length===1&&[negatives[0],positives[0]].every(m=>[route.token0,route.token1].includes(poolContract(m))&&Number.isInteger(m.decimals)&&m.decimals>=0&&m.decimals<=30);
      // Pool events must have nonzero opposing deltas matching the wallet's
      // direction. Wallet transfer amounts remain the actual consideration.
      const signed=w=>{const n=BigInt('0x'+w);return n>=2n**255n?n-2n**256n:n;};
      const poolDeltas=kind==='v2'?[BigInt('0x'+words[0])-BigInt('0x'+words[2]),BigInt('0x'+words[1])-BigInt('0x'+words[3])]:[signed(words[0]),signed(words[1])];
      const directions=correctLegs && poolDeltas[0]*poolDeltas[1]<0n && movements.every(m=>{const index=poolContract(m)===route.token0?0:1;return poolDeltas[index]*BigInt(m.delta_raw)<0n;});
      const poolFlow=[route.token0,route.token1].map(contract=>transfers.all.filter(t=>t.contract===contract).reduce((n,t)=>n+(t.to===route.pool?t.amount:0n)-(t.from===route.pool?t.amount:0n),0n));
      // A protocol topic alone is insufficient. The pool's actual transfers
      // must agree with its emitted economic deltas, including fee tokens.
      const backed=poolFlow.every((n,i)=>n===poolDeltas[i]);
      const path=(contract,start,end)=>{
        const reachable=new Set([start]);
        for(let i=0;i<transfers.all.length;i++)for(const t of transfers.all)if(t.contract===contract&&t.amount>0n&&reachable.has(t.from))reachable.add(t.to);
        return reachable.has(end);
      };
      const connected=correctLegs && movements.every(m=>BigInt(m.delta_raw)<0n
        ? path(poolContract(m),m.contract==='native'?address(transaction.to):wallet,route.pool)
        : path(poolContract(m),route.pool,m.contract==='native'?address(transaction.to):wallet));
      if(directions&&backed&&connected)reason='verified_pool_and_wallet_deltas'; else route=null;
    }
  }
  const bases=evmSettlementBases(chain);
  // The known settlement token's precision comes from Raven's exact chain
  // registry. Conflicting provider metadata cannot change the accounting unit.
  if(movements.some(m=>bases[m.contract]&&m.decimals!==bases[m.contract].decimals))route=null;
  const out=movements.find(m=>BigInt(m.delta_raw)<0n), incoming=movements.find(m=>BigInt(m.delta_raw)>0n);
  const buy=route&&bases[out.contract]&&!bases[incoming.contract],sell=route&&!bases[out.contract]&&bases[incoming.contract];
  const kind=buy?'SWAP_BUY':sell?'SWAP_SELL':movements.length===1?(BigInt(movements[0].delta_raw)>0n?'TRANSFER_IN':'TRANSFER_OUT'):'AMBIGUOUS';
  const id='swe_'+digest([chain,wallet,reference,'wallet_receipt_v1']);
  const endpoint=m=>m?{contract:m.contract,mint:m.contract,symbol:bases[m.contract]?.label||(typeof metadata.get(m.contract)?.symbol==='string'?metadata.get(m.contract).symbol.slice(0,24):null),decimals:m.decimals,amount_base_units:(BigInt(m.delta_raw)<0n?-BigInt(m.delta_raw):BigInt(m.delta_raw)).toString()}:null;
  return {
    schema_version:'ravenos.source_wallet_chain_event.v1',event_id:id,decode_version:101,
    source_wallet_id:null,source_wallet:{chain,network:'mainnet',chain_id:p.chain_id,vm_family:'evm',address:wallet},
    chain_evidence:{transaction_reference:reference,block_number:Number(BigInt(receipt.blockNumber)),block_hash:blockHash,block_time:new Date(at).toISOString(),transaction_index:Number(BigInt(receipt.transactionIndex||'0x0')),finality:'confirmed',provider,providers:[provider]},
    timing:{detected_at:new Date(at).toISOString(),raven_received_at:new Date(now).toISOString(),observation_mode:'historical_read_only'},
    classification:{kind,reasons:[reason],ambiguous:kind==='AMBIGUOUS'},economic:{source_asset:buy||sell||kind==='TRANSFER_OUT'?endpoint(out):null,destination_asset:buy||sell||kind==='TRANSFER_IN'?endpoint(incoming):null},
    wallet_accounting:{version:1,movements,native_evidence:nativeEvidence,trade:buy||sell?{kind,token:(buy?incoming:out).contract,quantity:BigInt((buy?incoming:out).delta_raw).toString().replace('-',''),decimals:(buy?incoming:out).decimals,basis:bases[(buy?out:incoming).contract],consideration:BigInt((buy?out:incoming).delta_raw).toString().replace('-','')}:null,route,gas_fee_units:quantity(receipt.gasUsed)!==null&&quantity(receipt.effectiveGasPrice)!==null?(quantity(receipt.gasUsed)*quantity(receipt.effectiveGasPrice)).toString():null},
    copy_signal:{eligible_buy_signal:false,eligible_sell_signal:false,source_signal_ready:false,reason:'historical_analysis_not_execution_authority'},
    evidence_hash:digest([receipt.blockHash,reference,movements,route]),
  };
}
