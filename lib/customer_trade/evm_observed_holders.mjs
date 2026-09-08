import { createHash } from 'node:crypto';
import { alchemyWalletHistoryRuntime } from './alchemy_wallet_history.mjs';
import { readEvmWalletRpcResponse } from './evm_wallet_receipt_policy.mjs';

export const EvmObservedHolderPolicy = Object.freeze({maximum_wallets:20, maximum_requests:48, maximum_ms:15000, confirmations:64});
const address = v => /^0x[0-9a-f]{40}$/i.test(v || '') ? v.toLowerCase() : null;
const quantity = v => /^0x[0-9a-f]{1,64}$/i.test(v || '') ? BigInt(v) : null;
const hash = v => /^0x[0-9a-f]{64}$/i.test(v || '');
const fail = code => { const error=new Error(code);error.code=code;error.status=502;throw error; };

// This is a current-balance sample, never a global top-holder ranking. Reuse
// retained exact-market observations first. One bounded token-index page is
// allowed only when Raven has no matching cached candidates.
export async function loadObservedEvmHolderInputs({env,identity,fetchImpl=globalThis.fetch,now=Date.now()}) {
  const runtime=alchemyWalletHistoryRuntime(env,identity.chain);
  if(!runtime.enabled)fail('holder_observed_source_unavailable');
  const policy=EvmObservedHolderPolicy,deadline=Date.now()+policy.maximum_ms;
  let requests=0;
  const rpc=async(method,params)=>{
    if(++requests>policy.maximum_requests||Date.now()>=deadline)fail('holder_observed_budget');
    let response;
    try {response=await fetchImpl(runtime.rpc_url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),redirect:'manual',signal:AbortSignal.timeout(Math.max(1,Math.min(4000,deadline-Date.now())))});}
    catch {fail('holder_observed_transport_unavailable');}
    return readEvmWalletRpcResponse(response,method,fail,'holder_observed');
  };
  if(quantity(await rpc('eth_chainId',[]))!==BigInt(runtime.profile.chain_id))fail('holder_observed_chain_mismatch');
  const head=quantity(await rpc('eth_blockNumber',[]));
  if(head===null)fail('holder_observed_head_invalid');
  const block='0x'+(head>BigInt(policy.confirmations)?head-BigInt(policy.confirmations):0n).toString(16);
  const blockInfo=await rpc('eth_getBlockByNumber',[block,false]);
  if(blockInfo?.number!==block||!hash(blockInfo?.hash)||quantity(blockInfo?.timestamp)===null)fail('holder_observed_head_invalid');
  const blockAt=Number(quantity(blockInfo.timestamp))*1000;
  if(!Number.isSafeInteger(blockAt)||blockAt>now+60000||blockAt<now-3600000)fail('holder_observed_head_stale');
  const candidates=new Set(),excluded=new Set([identity.pool_address,identity.token_address,identity.quote_token_address,'0x'+'0'.repeat(40)]);
  const add=value=>{const a=address(value);if(a&&!excluded.has(a)&&candidates.size<policy.maximum_wallets)candidates.add(a);};
  let candidateSource='raven_retained_exact_market';
  if(env.RAVENOS_CUSTOMER_DB)try {
    const marketId='wme_'+createHash('sha256').update(`${identity.chain}:pool:${identity.pool_address}`).digest('hex').slice(0,40);
    const rows=await env.RAVENOS_CUSTOMER_DB.prepare(`SELECT w.address FROM ravenos_source_wallet_market_evidence e
      JOIN ravenos_source_wallets w ON w.source_wallet_id=e.source_wallet_id AND w.chain=e.chain
      WHERE e.market_id=? AND e.chain=? AND e.last_event_at>=? AND e.last_event_at<=?
      AND json_extract(e.sample_json,'$.market.token_address')=? AND json_extract(e.sample_json,'$.market.quote_token_address')=?
      ORDER BY e.last_event_at DESC,w.address LIMIT ?`).bind(marketId,identity.chain,Math.floor(now/1000)-86400,Math.floor(now/1000)+60,identity.token_address,identity.quote_token_address,policy.maximum_wallets).all();
    for(const row of rows.results||[])add(row.address);
  } catch { /* No retained sample; the token-specific index can supply candidates. */ }
  if(!candidates.size) {
    candidateSource='alchemy_recent_token_transfers';
    const page=await rpc('alchemy_getAssetTransfers',[{fromBlock:'0x0',toBlock:block,contractAddresses:[identity.token_address],category:['erc20'],withMetadata:true,excludeZeroValue:true,maxCount:'0x14',order:'desc'}]);
    if(!Array.isArray(page?.transfers)||page.transfers.length>20)fail('holder_observed_index_invalid');
    for(const row of page.transfers){
      if(address(row.rawContract?.address)!==identity.token_address||row.category!=='erc20'||!hash(row.hash)||quantity(row.blockNum)===null||quantity(row.blockNum)>quantity(block)||!address(row.from)||!address(row.to))fail('holder_observed_index_identity_mismatch');
      add(row.to);add(row.from);
    }
  }
  if(!candidates.size)fail('holder_observed_candidates_unavailable');
  const [decimalsRaw,supplyRaw]=await Promise.all(['0x313ce567','0x18160ddd'].map(data=>rpc('eth_call',[{to:identity.token_address,data},block])));
  const decimals=quantity(decimalsRaw),supply=quantity(supplyRaw);
  if(decimals===null||decimals>255n||supply===null||supply<=0n)fail('holder_supply_unavailable');
  const items=[];let failures=0;
  const wallets=[...candidates];
  for(let i=0;i<wallets.length;i+=4)await Promise.all(wallets.slice(i,i+4).map(async wallet=>{
    try {
      const [amountRaw,code]=await Promise.all([
        rpc('eth_call',[{to:identity.token_address,data:'0x70a08231'+wallet.slice(2).padStart(64,'0')},block]),
        rpc('eth_getCode',[wallet,block]),
      ]);
      const amount=quantity(amountRaw);
      if(amount===null||amount>supply||!/^0x(?:[0-9a-f]{2})*$/i.test(code||''))throw Error('balance_unverified');
      if(amount>0n)items.push({value:amount.toString(),address:{hash:wallet,is_contract:code!=='0x'}});
    }catch{failures++;}
  }));
  const verifiedBlock=await rpc('eth_getBlockByNumber',[block,false]);
  if(verifiedBlock?.hash!==blockInfo.hash||verifiedBlock?.number!==block)fail('holder_observed_reorg');
  if(!items.length)fail('holder_observed_balances_unavailable');
  return {
    tokenPayload:{address_hash:identity.token_address,type:'ERC-20',decimals:decimals.toString(),total_supply:supply.toString(),holders_count:null},
    holderPayload:{items},
    evidence:{scope:'observed_wallet_balances',candidate_source:candidateSource,candidates:wallets.length,verified_candidates:wallets.length-failures,failed_candidates:failures,
      block_number:quantity(block).toString(),block_hash:blockInfo.hash,block_observed_at:new Date(blockAt).toISOString(),request_count:requests},
  };
}
