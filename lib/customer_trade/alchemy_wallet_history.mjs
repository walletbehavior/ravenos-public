import { decodeEvmWalletReceipt, WALLET_SWAP_TOPICS, evmSettlementBases } from './evm_wallet_swaps.mjs';
import { loadAlchemyTokenPrices } from './alchemy_token_prices.mjs';
import { resolveEvmChainProfile } from "./evm_chain_profiles.mjs";
import { EvmWalletReceiptPolicy, readEvmWalletRpcResponse } from './evm_wallet_receipt_policy.mjs';
const HOSTS=Object.freeze({ethereum:"eth-mainnet.g.alchemy.com",base:"base-mainnet.g.alchemy.com",bsc:"bnb-mainnet.g.alchemy.com",robinhood:"robinhood-mainnet.g.alchemy.com"});
const address=value=>/^0x[0-9a-f]{40}$/i.test(String(value||""))?value.toLowerCase():null;
const txHash=value=>/^0x[0-9a-f]{64}$/i.test(String(value||""))?value.toLowerCase():null;
const raw=value=>typeof value==="string"&&/^0x[0-9a-f]{1,64}$/i.test(value)?BigInt(value).toString():null;
const publicMetadata=new Map();
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
export function alchemyWalletHistoryRuntime(env={},chain) {
 if(env.RAVENOS_ALCHEMY_WALLET_HISTORY_ENABLED!=="1")return {enabled:false,state:"disabled"};
 const profile=resolveEvmChainProfile(chain),prefix=chain==="ethereum"?"ETH":chain.toUpperCase();
 let configured=env[`RAVENOS_${prefix}_ALCHEMY_RPC_URL`]||env[`ALCHEMY_${prefix}_RPC_URL`]||env[`${profile.environment_prefix}_ALCHEMY_RPC_URL`];
 let configurationSource='chain_specific';
 // Alchemy app keys can allow multiple networks. Try the already configured
 // Raven app on Robinhood only; its network permissions are still enforced by
 // Alchemy. Never send a key outside the exact Alchemy host for this chain.
 if(!configured&&chain==='robinhood'&&env.RAVENOS_EVM_WALLET_RECONSTRUCTION_ENABLED==='1')try{
  const shared=new URL(env.ALCHEMY_BASE_RPC_URL||env.RAVENOS_BASE_ALCHEMY_RPC_URL);
  if(shared.protocol==='https:'&&shared.hostname===HOSTS.base&&!shared.username&&!shared.password&&!shared.port&&!shared.search&&!shared.hash&&/^\/v2\/[A-Za-z0-9_-]+$/.test(shared.pathname)){
   configured=`https://${HOSTS.robinhood}${shared.pathname}`;configurationSource='existing_alchemy_app_key';
  }
 }catch{/* no suitable shared app connection */}
 let url;try{url=new URL(configured);}catch{return {enabled:false,state:"misconfigured"};}
 if(url.protocol!=="https:"||url.hostname!==HOSTS[chain]||url.username||url.password||url.port||url.search||url.hash||!/^\/v2\/[A-Za-z0-9_-]+$/.test(url.pathname))return {enabled:false,state:"misconfigured"};
 return {enabled:true,state:"configured",provider:"alchemy_wallet_history",configuration_source:configurationSource,rpc_url:url.toString(),profile};
}
async function batchMap(rows,limit,fn) {
 const results=[];for(let i=0;i<rows.length;i+=limit)results.push(...await Promise.all(rows.slice(i,i+limit).map(fn)));return results;
}
export async function loadAlchemyWalletInputs(env,chain,wallet,{fetchImpl=globalThis.fetch,priorAnalysis=null,now=Date.now(),historyPage=null,rpcOverride=null}={}) {
 const runtime=alchemyWalletHistoryRuntime(env,chain);if(!runtime.enabled)fail(`alchemy_wallet_history_${runtime.state}`);
 if(!address(wallet))fail("wallet_address_invalid");wallet=address(wallet);
 let requests=0;const deadline=Date.now()+25000;
 const rpc=async(method,params)=>{
  if (Date.now()>=deadline)fail("alchemy_wallet_time_budget");
  if (requests >= 120) fail("alchemy_wallet_request_budget");
  requests++;
  if (rpcOverride) return rpcOverride(method,params);
  const response=await fetchImpl(runtime.rpc_url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:AbortSignal.timeout(Math.max(1,Math.min(6500,deadline-Date.now()))),redirect:"manual"});
  return readEvmWalletRpcResponse(response,method,fail,'alchemy_wallet');
 };
 const actualChain=await rpc("eth_chainId",[]);if(raw(actualChain)!==String(runtime.profile.chain_id))fail("alchemy_wallet_chain_mismatch");
 const base={fromBlock:"0x0",toBlock:"latest",category:["erc20"],withMetadata:true,excludeZeroValue:true,maxCount:"0x18",order:"desc"};
 const initial=historyPage ? [{transfers:historyPage.transfers},{transfers:[]},{address:wallet,tokenBalances:[]},null].map(value=>({status:"fulfilled",value})) : await Promise.allSettled([rpc("alchemy_getAssetTransfers",[{...base,fromAddress:wallet}]),rpc("alchemy_getAssetTransfers",[{...base,toAddress:wallet}]),rpc("alchemy_getTokenBalances",[wallet,"erc20",{maxCount:24}]),rpc("eth_getBalance",[wallet,"latest"])]);
 const [outbound,inbound,tokens,native]=initial.map(row=>row.status==="fulfilled"?row.value:null);
 if(!outbound&&!inbound&&!tokens&&!native)fail("alchemy_wallet_lookup_unavailable");
 for(const page of [outbound,inbound])if(page&&(!Array.isArray(page.transfers)||page.transfers.length>24))fail("alchemy_wallet_transfer_page_invalid");
 if(tokens&&(address(tokens.address)!==wallet||!Array.isArray(tokens.tokenBalances)||tokens.tokenBalances.length>24))fail("alchemy_wallet_balance_identity_mismatch");
 const transferMap=new Map();
 for(const transfer of [...(outbound?.transfers||[]),...(inbound?.transfers||[])]) {
  if(!txHash(transfer.hash)||!transfer.uniqueId||!["erc20","external"].includes(transfer.category)||!address(transfer.from)||!address(transfer.to)||(address(transfer.from)!==wallet&&address(transfer.to)!==wallet)||raw(transfer.blockNum)===null)fail("alchemy_wallet_transfer_identity_mismatch");
  transferMap.set(transfer.uniqueId,transfer);
 }
 const transfers=[...transferMap.values()].sort((a,b)=>Number(BigInt(b.blockNum)-BigInt(a.blockNum)));
 const references=[...new Set(transfers.map(t=>t.hash.toLowerCase()))].slice(0,12);
 let retainedLogs=0;
 const receipts=new Map(await batchMap(references,2,async reference=>{try{
  const receipt=await rpc("eth_getTransactionReceipt",[reference]);
  if(Array.isArray(receipt?.logs)){
   if(receipt.logs.length>EvmWalletReceiptPolicy.maximum_logs || retainedLogs+receipt.logs.length>EvmWalletReceiptPolicy.maximum_lookup_logs)fail('alchemy_wallet_receipt_log_budget');
   retainedLogs+=receipt.logs.length;
  }
  return [reference,receipt];
 }catch(error){if(historyPage)throw error;return [reference,null];}}));
 const tokenRows=(tokens?.tokenBalances||[]).filter(row=>address(row.contractAddress)&&raw(row.tokenBalance)!==null&&BigInt(row.tokenBalance)>0n);
 const contracts=[...new Set([...tokenRows.map(row=>address(row.contractAddress)),...transfers.filter(row=>receipts.has(row.hash.toLowerCase())).map(row=>address(row.rawContract?.address)).filter(Boolean),...Array.from(receipts.values()).flatMap(receipt=>(receipt?.logs||[]).filter(log=>log.topics?.[0]?.toLowerCase()===WALLET_SWAP_TOPICS.transfer && log.topics.slice(1).some(topic=>typeof topic==="string" && topic.slice(-40).toLowerCase()===wallet.slice(2))).map(log=>address(log.address)).filter(Boolean))])].slice(0,32);
 const metadata=new Map(await batchMap(contracts,4,async contract=>{
  const key=chain+':'+contract,cached=publicMetadata.get(key);
  if(cached?.expires>Date.now())return [contract,cached.value];
  let value=null;try{
   const meta=await rpc("alchemy_getTokenMetadata",[contract]);
   if(meta&&typeof meta==='object')value={decimals:Number.isInteger(meta.decimals)&&meta.decimals>=0&&meta.decimals<=255?meta.decimals:null,symbol:typeof meta.symbol==='string'?meta.symbol.slice(0,24):null,name:typeof meta.name==='string'?meta.name.slice(0,100):null};
  }catch{/* missing metadata stays unknown */}
  while(publicMetadata.size>=2048)publicMetadata.delete(publicMetadata.keys().next().value);
  publicMetadata.set(key,{value,expires:Date.now()+(value?3600000:60000)});return [contract,value];
 }));
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
 const reconstructionEnabled=env.RAVENOS_EVM_WALLET_RECONSTRUCTION_ENABLED==='1';
 const accountingEvents=[],openingBalances={};let reconstructionPartial=false,historyStartBlock=null,mergePrevious=false;
 if(reconstructionEnabled) {
  const verified=[...receipts].filter(([reference,receipt])=>receipt && txHash(receipt.transactionHash)===reference && receipt.status==='0x1' && txHash(receipt.blockHash) && raw(receipt.blockNumber)!==null && Array.isArray(receipt.logs)
    && transfers.some(t=>t.hash.toLowerCase()===reference&&BigInt(t.blockNum)===BigInt(receipt.blockNumber)));
  historyStartBlock=verified.length?Math.min(...verified.map(([,r])=>Number(BigInt(r.blockNumber)))):null;
  const pageBoundaryUnknown=[outbound,inbound].some(page=>page?.pageKey&&(!page.transfers.length||Math.min(...page.transfers.map(t=>Number(BigInt(t.blockNum))))>=historyStartBlock));
  const boundaryOmitted=transfers.some(t=>!receipts.has(t.hash.toLowerCase())&&Number(BigInt(t.blockNum))>=historyStartBlock);
  reconstructionPartial=Boolean(historyPage)||pageBoundaryUnknown||invalidReceipts>0||initial.slice(0,2).some(r=>r.status!=='fulfilled')||boundaryOmitted;
  const transactions=new Map(await batchMap(verified.filter(([,r])=>historyPage || r.logs.some(log=>[WALLET_SWAP_TOPICS.v2,WALLET_SWAP_TOPICS.v3].includes(log.topics?.[0]?.toLowerCase()))),4,async([ref])=>{
   try{return [ref,await rpc('eth_getTransactionByHash',[ref])];}catch{return [ref,null];}
  }));
  let poolChecks=0;
  // All logs from each admitted receipt are decoded together, never a clipped
  // transfer page. Pool RPC work is capped independently of wallet size.
  for(const [ref,receipt] of verified) {
   try {
    const event=await decodeEvmWalletReceipt({chain,wallet,receipt,transaction:transactions.get(ref),time:transfers.find(t=>t.hash.toLowerCase()===ref)?.metadata?.blockTimestamp,metadata,now,rpc:async(method,params)=>{
      if(method==='eth_call'&&++poolChecks>36)throw Error('pool_verification_budget');return rpc(method,params);
    }});
    if(event)accountingEvents.push(event);else reconstructionPartial=true;
   } catch {reconstructionPartial=true;}
  }
  mergePrevious=!reconstructionPartial&&priorAnalysis?.window_complete===true&&Number.isSafeInteger(priorAnalysis.history_start_block)&&Number.isSafeInteger(priorAnalysis.history_end_block)&&historyStartBlock<=priorAnalysis.history_end_block
    && accountingEvents.some(e=>e.chain_evidence.block_number>=priorAnalysis.history_end_block)
    && accountingEvents.some(e=>priorAnalysis.events?.some(old=>old.chain_evidence.transaction_reference===e.chain_evidence.transaction_reference&&old.chain_evidence.block_hash===e.chain_evidence.block_hash));
  if(mergePrevious){historyStartBlock=Math.min(historyStartBlock,priorAnalysis.history_start_block);Object.assign(openingBalances,priorAnalysis.opening_balances);}
  const tradingTokens=[...new Set(accountingEvents.map(e=>e.wallet_accounting.trade?.token).filter(Boolean))].slice(0,16);
  if(!reconstructionPartial&&historyStartBlock!==null&&historyStartBlock>0)await batchMap(tradingTokens,4,async contract=>{
    if(openingBalances[contract]!=null)return;
    try {const value=await rpc('eth_call',[{to:contract,data:'0x70a08231'+wallet.slice(2).padStart(64,'0')},'0x'+(historyStartBlock-1).toString(16)]);openingBalances[contract]=raw(value);}catch{openingBalances[contract]=null;}
  });
  const prices=await loadAlchemyTokenPrices({chain,contracts:tokenRows.map(r=>address(r.contractAddress)),rpcUrl:runtime.rpc_url,fetchImpl,now});requests+=prices.request_count;
  for(const row of balances) {const mark=prices.rows.find(p=>p.contract===row.token.address_hash);if(mark){row.token.exchange_rate=mark.price;row.token.mark_observed_at=mark.observed_at;row.token.mark_provider=mark.provider;}}
 }
 return {reconstruction:reconstructionEnabled?{events:accountingEvents,merge_previous:mergePrevious,opening_balances:openingBalances,bases:evmSettlementBases(chain),history_start_block:historyStartBlock,history_end_block:accountingEvents.length?Math.max(...accountingEvents.map(e=>e.chain_evidence.block_number)):null,window_complete:!reconstructionPartial}:null,provider:runtime.provider,info:{hash:wallet,coin_balance:raw(native)},counters:{transactions_count:null,token_transfers_count:null},tokensPayload:{items:balances,next_page_params:tokens?.pageKey||null},transfersPayload:{items:activity.slice(0,50),next_page_params:outbound?.pageKey||inbound?.pageKey||null},partial:initial.some(r=>r.status==="rejected")||invalidReceipts>0||references.length<new Set(transfers.map(t=>t.hash)).size||activity.length>50||balances.some(row=>row.token.decimals===null),request_count:requests,provider_indexed_transfer_count:transfers.length,receipt_verified_transaction_count:references.length-invalidReceipts};
}
