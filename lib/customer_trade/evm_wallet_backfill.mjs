import { alchemyWalletHistoryRuntime, loadAlchemyWalletInputs } from './alchemy_wallet_history.mjs';
import { normalizeSourceWalletChainIdentity } from './source_wallet_chain_identity.mjs';
import { readEvmWalletRpcResponse } from './evm_wallet_receipt_policy.mjs';

export const EvmWalletBackfillPolicy = Object.freeze({
  history_days: 30, transfer_page_size: 8, transactions_per_run: 4,
  maximum_requests_per_run: 100, maximum_run_ms: 30000,
  confirmations: 64, page_token_max_age_ms: 8 * 60000,
});
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const hash = value => /^0x[0-9a-f]{64}$/i.test(value || '');
const hex = value => /^0x[0-9a-f]{1,16}$/i.test(value || '');

// Both directions use one pinned head. Tokens are merely an optimization: when
// a token expires, resume inclusively at the last completed block. Event IDs
// deduplicate that overlap; we never subtract one and skip a same-block trade.
export async function loadEvmWalletBackfillPage(env, job, {fetchImpl=globalThis.fetch, now=Date.now(), existingTransaction=null}={}) {
  if (env.RAVENOS_EVM_WALLET_BACKFILL_ENABLED !== '1') fail('evm_wallet_backfill_disabled');
  const {chain,address} = job.source_wallet;
  const id = normalizeSourceWalletChainIdentity({chain,network:'mainnet',address});
  if (id.vm_family !== 'evm' || id.source_wallet_id !== job.source_wallet_id) fail('evm_wallet_backfill_identity_invalid');
  const runtime = alchemyWalletHistoryRuntime(env,chain);
  if (!runtime.enabled || env.RAVENOS_EVM_WALLET_RECONSTRUCTION_ENABLED !== '1') fail('evm_wallet_backfill_provider_disabled');
  const policy = EvmWalletBackfillPolicy, deadline = Date.now()+policy.maximum_run_ms;
  let requests = 0;
  const rpc = async (method,params) => {
    if (++requests > policy.maximum_requests_per_run || Date.now() >= deadline) fail('evm_wallet_backfill_budget');
    let response;
    try { response = await fetchImpl(runtime.rpc_url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),redirect:'manual',signal:AbortSignal.timeout(Math.max(1,Math.min(6500,deadline-Date.now())))}); }
    catch { fail('evm_wallet_backfill_transport_unavailable'); }
    return readEvmWalletRpcResponse(response,method,fail,'evm_wallet_backfill');
  };
  const actual = await rpc('eth_chainId',[]);
  if (!hex(actual) || BigInt(actual) !== BigInt(runtime.profile.chain_id)) fail('alchemy_wallet_chain_mismatch');
  let cursor = job.provider_cursor ? structuredClone(job.provider_cursor) : null;
  if (!cursor) {
    const latest = await rpc('eth_blockNumber',[]);
    if (!hex(latest)) fail('evm_wallet_backfill_head_invalid');
    const head = BigInt(latest)>BigInt(policy.confirmations) ? BigInt(latest)-BigInt(policy.confirmations) : 0n;
    cursor={version:1,head:'0x'+head.toString(16),head_hash:null,direction:'in',page_key:null,page_key_at:null,seek_block:'0x'+head.toString(16),pending:[],coverage_start_at:new Date(now-policy.history_days*86400000).toISOString(),coverage_end_at:null,provider_exhausted:{in:false,out:false}};
  }
  if (cursor.version !== 1 || !hex(cursor.head) || !hex(cursor.seek_block) || !['in','out','done'].includes(cursor.direction) || !Array.isArray(cursor.pending) || cursor.pending.length>policy.transfer_page_size || !Number.isFinite(Date.parse(cursor.coverage_start_at))) fail('evm_wallet_backfill_cursor_invalid');
  let headBlock = await rpc('eth_getBlockByNumber',[cursor.head,false]);
  if (!hash(headBlock?.hash) || headBlock.number !== cursor.head || !hex(headBlock.timestamp)) fail('evm_wallet_backfill_head_invalid');
  if (cursor.head_hash && cursor.head_hash !== headBlock.hash) fail('evm_wallet_backfill_reorg_requires_review');
  if(cursor.advance_from_head){
    const latest=await rpc('eth_blockNumber',[]);
    if(!hex(latest))fail('evm_wallet_backfill_head_invalid');
    const next=BigInt(latest)>BigInt(policy.confirmations)?BigInt(latest)-BigInt(policy.confirmations):0n;
    if(next>BigInt(cursor.head)){
      cursor.scan_from_block='0x'+(BigInt(cursor.head)+1n).toString(16);
      cursor.head='0x'+next.toString(16);
      headBlock=await rpc('eth_getBlockByNumber',[cursor.head,false]);
      if(!hash(headBlock?.hash)||headBlock.number!==cursor.head||!hex(headBlock.timestamp))fail('evm_wallet_backfill_head_invalid');
      cursor.direction='in';cursor.seek_block=cursor.head;cursor.pending=[];cursor.page_key=null;cursor.direction_finished=false;
      cursor.provider_exhausted={in:false,out:false};
    }
    cursor.advance_from_head=false;
  }
  cursor.head_hash=headBlock.hash;
  cursor.coverage_end_at=new Date(Number(BigInt(headBlock.timestamp))*1000).toISOString();
  if (!cursor.from_block) {
    let lo=0n, hi=BigInt(cursor.head);
    const cutoff=Math.floor(Date.parse(cursor.coverage_start_at)/1000);
    while (lo<hi) {
      const mid=(lo+hi)/2n, block=await rpc('eth_getBlockByNumber',['0x'+mid.toString(16),false]);
      if (!hex(block?.timestamp) || !hex(block?.number) || BigInt(block.number)!==mid) fail('evm_wallet_backfill_boundary_invalid');
      if (Number(BigInt(block.timestamp))<cutoff) lo=mid+1n; else hi=mid;
    }
    cursor.from_block='0x'+lo.toString(16); cursor.opening_balances={};
  }
  if (!hex(cursor.from_block) || BigInt(cursor.from_block)>BigInt(cursor.head)) fail('evm_wallet_backfill_cursor_invalid');
  if (cursor.direction === 'done') return {events:[],reference_count:0,cursor,exhausted:true,request_count:requests};
  if (!cursor.pending.length) {
    const useToken = cursor.page_key && now-cursor.page_key_at < policy.page_token_max_age_ms;
    const params={fromBlock:cursor.scan_from_block || cursor.from_block,toBlock:useToken ? cursor.query_to_block : cursor.seek_block,category:['erc20','external'],withMetadata:true,excludeZeroValue:true,maxCount:'0x'+policy.transfer_page_size.toString(16),order:'desc',[cursor.direction==='in'?'toAddress':'fromAddress']:address,...(useToken?{pageKey:cursor.page_key}:{})};
    const page=await rpc('alchemy_getAssetTransfers',[params]);
    if (!Array.isArray(page?.transfers) || page.transfers.length>policy.transfer_page_size || (page.pageKey && (typeof page.pageKey!=='string'||page.pageKey.length>512))) fail('evm_wallet_backfill_page_invalid');
    let previous=BigInt(params.toBlock), reachedBoundary=false;
    const references=new Map();
    for (const row of page.transfers) {
      const time=Date.parse(row.metadata?.blockTimestamp);
      if (!hash(row.hash) || !hex(row.blockNum) || BigInt(row.blockNum)>previous || !Number.isFinite(time) || time>Date.parse(cursor.coverage_end_at)+60000 || row[cursor.direction==='in'?'to':'from']?.toLowerCase()!==address || !['erc20','external'].includes(row.category)) fail('evm_wallet_backfill_transfer_invalid');
      previous=BigInt(row.blockNum);
      if (time<Date.parse(cursor.coverage_start_at)) { reachedBoundary=true; continue; }
      // Minimal index evidence; the complete receipt is fetched by the existing decoder.
      references.set(row.hash.toLowerCase(),{hash:row.hash.toLowerCase(),blockNum:row.blockNum,uniqueId:row.hash.toLowerCase(),category:row.category,from:row.from?.toLowerCase(),to:row.to?.toLowerCase(),metadata:{blockTimestamp:row.metadata.blockTimestamp},rawContract:{address:row.rawContract?.address||null}});
    }
    cursor.query_to_block=params.toBlock;
    cursor.pending=[...references.values()];
    cursor.page_key=page.pageKey || null; cursor.page_key_at=now;
    cursor.seek_block=page.transfers.at(-1)?.blockNum || cursor.seek_block;
    cursor.direction_finished=!page.pageKey || reachedBoundary;
    cursor.provider_exhausted[cursor.direction]=!page.pageKey;
  }
  const selected=cursor.pending.slice(0,policy.transactions_per_run), events=[];
  const blocks=new Map();
  for (const row of selected) {
    // Verify timestamp/block identity independently of the transfer index.
    let block=blocks.get(row.blockNum);
    if (!block) { block=await rpc('eth_getBlockByNumber',[row.blockNum,false]); blocks.set(row.blockNum,block); }
    if (!hash(block?.hash)||block.number!==row.blockNum||!hex(block.timestamp)||new Date(Number(BigInt(block.timestamp))*1000).toISOString()!==new Date(row.metadata.blockTimestamp).toISOString()) fail('evm_wallet_backfill_block_mismatch');
    const retained = existingTransaction ? await existingTransaction(id.source_wallet_id,row.hash,block.hash) : null;
    let event = retained && typeof retained === 'object' ? retained : null;
    if (retained === true) continue;
    if (!event) {
    const result=await loadAlchemyWalletInputs(env,chain,address,{now,fetchImpl,rpcOverride:rpc,historyPage:{transfers:[row]}});
    event=result.reconstruction?.events?.[0];
    if (!event || result.reconstruction.events.length!==1 || event.chain_evidence.block_hash!==block.hash || event.chain_evidence.transaction_reference!==row.hash) fail('evm_wallet_backfill_receipt_incomplete');
    events.push({...event,source_wallet_id:id.source_wallet_id});
    }
    const contract=event.wallet_accounting?.trade?.token;
    if (contract && !Object.hasOwn(cursor.opening_balances,contract) && Object.keys(cursor.opening_balances).length<100) {
      if (BigInt(cursor.from_block)===0n) cursor.opening_balances[contract]='0';
      else {
        try { const amount=await rpc('eth_call',[{to:contract,data:'0x70a08231'+address.slice(2).padStart(64,'0')},'0x'+(BigInt(cursor.from_block)-1n).toString(16)]);
          if (/^0x[0-9a-f]{1,64}$/i.test(amount)) cursor.opening_balances[contract]=BigInt(amount).toString();
          else if (amount==='0x' && await rpc('eth_getCode',[contract,'0x'+(BigInt(cursor.from_block)-1n).toString(16)])==='0x') cursor.opening_balances[contract]='0';
        } catch { /* Missing archive inventory leaves cost basis unknown. */ }
      }
    }
  }
  cursor.pending=cursor.pending.slice(selected.length);
  if (!cursor.pending.length && cursor.direction_finished) {
    cursor.direction=cursor.direction==='in'?'out':'done';cursor.seek_block=cursor.head;cursor.page_key=null;cursor.page_key_at=null;cursor.direction_finished=false;
  }
  if(cursor.direction==='done'){cursor.verified_through_block=cursor.head;cursor.verified_through_at=cursor.coverage_end_at;}
  return {events,reference_count:selected.length,cursor,exhausted:cursor.direction==='done',request_count:requests};
}
