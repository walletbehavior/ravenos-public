import { resolveEvmChainProfile } from "./evm_chain_profiles.mjs";
const HOSTS=Object.freeze({ethereum:"eth-mainnet.g.alchemy.com",base:"base-mainnet.g.alchemy.com",bsc:"bnb-mainnet.g.alchemy.com",robinhood:"robinhood-mainnet.g.alchemy.com"});
const address=value=>/^0x[0-9a-f]{40}$/i.test(String(value||""))?value.toLowerCase():null;
const txHash=value=>/^0x[0-9a-f]{64}$/i.test(String(value||""))?value.toLowerCase():null;
const raw=value=>typeof value==="string"&&/^0x[0-9a-f]{1,64}$/i.test(value)?BigInt(value).toString():null;
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
export function alchemyWalletHistoryRuntime(env={},chain) {
 if(env.RAVENOS_ALCHEMY_WALLET_HISTORY_ENABLED!=="1")return {enabled:false,state:"disabled"};
 const profile=resolveEvmChainProfile(chain),prefix=chain==="ethereum"?"ETH":chain.toUpperCase();
 const configured=env[`RAVENOS_${prefix}_ALCHEMY_RPC_URL`]||env[`ALCHEMY_${prefix}_RPC_URL`]||env[`${profile.environment_prefix}_ALCHEMY_RPC_URL`];
 let url;try{url=new URL(configured);}catch{return {enabled:false,state:"misconfigured"};}
 if(url.protocol!=="https:"||url.hostname!==HOSTS[chain]||url.username||url.password||!/^\/v2\/[A-Za-z0-9_-]+$/.test(url.pathname))return {enabled:false,state:"misconfigured"};
 return {enabled:true,state:"configured",provider:"alchemy_wallet_history",rpc_url:url.toString(),profile};
}
async function batchMap(rows,limit,fn) {
 const results=[];for(let i=0;i<rows.length;i+=limit)results.push(...await Promise.all(rows.slice(i,i+limit).map(fn)));return results;
}
export async function loadAlchemyWalletInputs(env,chain,wallet,{fetchImpl=globalThis.fetch}={}) {
 const runtime=alchemyWalletHistoryRuntime(env,chain);if(!runtime.enabled)fail(`alchemy_wallet_history_${runtime.state}`);
 if(!address(wallet))fail("wallet_address_invalid");wallet=address(wallet);
 let requests=0;
 const rpc=async(method,params)=>{
  requests++;
  const response=await fetchImpl(runtime.rpc_url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:AbortSignal.timeout(6500),redirect:"manual"});
  if(!response.ok)fail("alchemy_wallet_provider_unavailable");
  if(Number(response.headers.get("content-length"))>1024*1024)fail("alchemy_wallet_response_too_large");
  const text=await response.text();if(text.length>1024*1024||!response.ok)fail("alchemy_wallet_provider_unavailable");
  let data;try{data=JSON.parse(text);}catch{fail("alchemy_wallet_response_invalid");}
  if(data.id!==1||data.error||!Object.hasOwn(data,"result"))fail("alchemy_wallet_method_unavailable");return data.result;
 };
 const actualChain=await rpc("eth_chainId",[]);if(raw(actualChain)!==String(runtime.profile.chain_id))fail("alchemy_wallet_chain_mismatch");
 const base={fromBlock:"0x0",toBlock:"latest",category:["erc20"],withMetadata:true,excludeZeroValue:true,maxCount:"0x18",order:"desc"};
 const initial=await Promise.allSettled([rpc("alchemy_getAssetTransfers",[{...base,fromAddress:wallet}]),rpc("alchemy_getAssetTransfers",[{...base,toAddress:wallet}]),rpc("alchemy_getTokenBalances",[wallet,"erc20",{maxCount:24}]),rpc("eth_getBalance",[wallet,"latest"])]);
 const [outbound,inbound,tokens,native]=initial.map(row=>row.status==="fulfilled"?row.value:null);
 if(!outbound&&!inbound&&!tokens&&!native)fail("alchemy_wallet_lookup_unavailable");
 for(const page of [outbound,inbound])if(page&&(!Array.isArray(page.transfers)||page.transfers.length>24))fail("alchemy_wallet_transfer_page_invalid");
 if(tokens&&(address(tokens.address)!==wallet||!Array.isArray(tokens.tokenBalances)||tokens.tokenBalances.length>24))fail("alchemy_wallet_balance_identity_mismatch");
 const transferMap=new Map();
 for(const transfer of [...(outbound?.transfers||[]),...(inbound?.transfers||[])]) {
  if(!txHash(transfer.hash)||!transfer.uniqueId||transfer.category!=="erc20"||!address(transfer.from)||!address(transfer.to)||(address(transfer.from)!==wallet&&address(transfer.to)!==wallet)||raw(transfer.blockNum)===null)fail("alchemy_wallet_transfer_identity_mismatch");
  transferMap.set(transfer.uniqueId,transfer);
 }
 const transfers=[...transferMap.values()].sort((a,b)=>Number(BigInt(b.blockNum)-BigInt(a.blockNum)));
 const references=[...new Set(transfers.map(t=>t.hash.toLowerCase()))].slice(0,12);
 const receipts=new Map(await batchMap(references,4,async reference=>{try{return [reference,await rpc("eth_getTransactionReceipt",[reference])];}catch{return [reference,null];}}));
 const tokenRows=(tokens?.tokenBalances||[]).filter(row=>address(row.contractAddress)&&raw(row.tokenBalance)!==null&&BigInt(row.tokenBalance)>0n);
 const contracts=[...new Set([...tokenRows.map(row=>address(row.contractAddress)),...transfers.filter(row=>receipts.has(row.hash.toLowerCase())).map(row=>address(row.rawContract?.address)).filter(Boolean)])].slice(0,32);
 const metadata=new Map(await batchMap(contracts,4,async contract=>{try{return [contract,await rpc("alchemy_getTokenMetadata",[contract])];}catch{return [contract,null];}}));
 const token=contract=>{const meta=metadata.get(contract);return {address_hash:contract,decimals:Number.isInteger(meta?.decimals)&&meta.decimals>=0&&meta.decimals<=255?meta.decimals:null,symbol:typeof meta?.symbol==="string"?meta.symbol.slice(0,24):null,name:typeof meta?.name==="string"?meta.name.slice(0,100):null,type:"ERC-20",exchange_rate:null};};
 const balances=tokenRows.map(row=>({value:raw(row.tokenBalance),token:token(address(row.contractAddress))}));
 const activity=[],seenLogs=new Set();let invalidReceipts=0;
 // Receipt logs establish exact amounts and block hashes. Indexer values and
 // labels alone are never promoted to executed swaps or cost-basis evidence.
 for(const [reference,receipt] of receipts) {
  if(!receipt||txHash(receipt.transactionHash)!==reference||!txHash(receipt.blockHash)||raw(receipt.blockNumber)===null||receipt.status!=="0x1"||!Array.isArray(receipt.logs)){invalidReceipts++;continue;}
  const indexed=transfers.find(t=>t.hash.toLowerCase()===reference);
  if(BigInt(receipt.blockNumber)!==BigInt(indexed.blockNum)){invalidReceipts++;continue;}
  for(const log of receipt.logs) {
   if(log.removed||log.topics?.length!==3||log.topics[0]?.toLowerCase()!=="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"||!/^0x[0-9a-f]{64}$/i.test(log.data||""))continue;
   if(!log.topics.slice(1).every(t=>/^0x0{24}[0-9a-f]{40}$/i.test(t)))continue;
   const from=address(`0x${log.topics[1].slice(-40)}`),to=address(`0x${log.topics[2].slice(-40)}`),contract=address(log.address),index=raw(log.logIndex);
   if(!contract||index===null||(from!==wallet&&to!==wallet)||!metadata.has(contract))continue;
   const key=`${reference}:${index}`;if(seenLogs.has(key))continue;seenLogs.add(key);
   activity.push({transaction_hash:reference,block_hash:receipt.blockHash.toLowerCase(),block_number:raw(receipt.blockNumber),log_index:index,from:{hash:from},to:{hash:to},timestamp:indexed.metadata?.blockTimestamp||null,token:token(contract),total:{value:raw(log.data),decimals:token(contract).decimals}});
  }
 }
 return {provider:runtime.provider,info:{hash:wallet,coin_balance:raw(native)},counters:{transactions_count:null,token_transfers_count:null},tokensPayload:{items:balances,next_page_params:tokens?.pageKey||null},transfersPayload:{items:activity.slice(0,50),next_page_params:outbound?.pageKey||inbound?.pageKey||null},partial:initial.some(r=>r.status==="rejected")||invalidReceipts>0||references.length<new Set(transfers.map(t=>t.hash)).size||activity.length>50||balances.some(row=>row.token.decimals===null),request_count:requests,provider_indexed_transfer_count:transfers.length,receipt_verified_transaction_count:references.length-invalidReceipts};
}
