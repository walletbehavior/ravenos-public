import { normalizeSolanaWalletTransaction } from "./solana_wallet_intelligence.mjs";
import bs58 from "bs58";
const TRANSACTIONS=new Map();
const CACHE_MAX_BYTES=8*1024*1024;
let cacheBytes=0;
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
export function heliusWalletHistoryRuntime(env={}) {
 if(env.RAVENOS_HELIUS_WALLET_HISTORY_ENABLED!=="1")return {enabled:false,state:"disabled"};
 return heliusWalletReadRuntime(env);
}
export function heliusWalletReadRuntime(env={}) {
 const key=String(env.HELIUS_API_KEY||env.RAVENOS_HELIUS_API_KEY||"").trim();
 let url;
 try {url=new URL(env.RAVENOS_HELIUS_RPC_URL||`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`);}catch{return {enabled:false,state:"misconfigured"};}
 if(url.protocol!=="https:"||url.hostname!=="mainnet.helius-rpc.com"||url.username||url.password||!url.searchParams.get("api-key"))return {enabled:false,state:"misconfigured"};
 return {enabled:true,state:"configured",rpc_url:url.toString(),provider:"helius_address_history",maximum_page_transactions:100};
}
function cacheTransaction(signature,transaction,commitment,now) {
 const size=new TextEncoder().encode(JSON.stringify(transaction)).byteLength;
 for(const [key,row] of TRANSACTIONS) if(row.expires_at<=now){cacheBytes-=row.size;TRANSACTIONS.delete(key);}
 if(size>CACHE_MAX_BYTES)return;
 while(TRANSACTIONS.size&&(cacheBytes+size>CACHE_MAX_BYTES||TRANSACTIONS.size>=256)){const key=TRANSACTIONS.keys().next().value;cacheBytes-=TRANSACTIONS.get(key).size;TRANSACTIONS.delete(key);}
 const previous=TRANSACTIONS.get(signature);if(previous)cacheBytes-=previous.size;
 TRANSACTIONS.set(signature,{transaction,commitment,size,expires_at:now+60000});cacheBytes+=size;
}
export function cachedHeliusWalletTransaction(signature,commitment="confirmed",now=Date.now()) {
 const row=TRANSACTIONS.get(signature);
 if(!row||row.expires_at<=now||(commitment==="finalized"&&row.commitment!=="finalized"))return null;
 return row.transaction;
}
export async function loadHeliusWalletPage(env,{address,limit=24,before=null,pagination_token=null,commitment="confirmed",now=Date.now()},{rpc}={}) {
 const runtime=heliusWalletHistoryRuntime(env);
 if(!runtime.enabled)fail(`helius_wallet_history_${runtime.state}`);
 try {if(bs58.decode(address).length!==32)throw new Error();}catch{fail("wallet_address_invalid");}
 if(!["confirmed","finalized"].includes(commitment)||!Number.isInteger(limit)||limit<1||limit>100)fail("helius_wallet_request_invalid");
 if(before&&!/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(before))fail("helius_wallet_cursor_invalid");
 if(pagination_token&&!/^\d{1,15}:\d{1,10}$/.test(pagination_token))fail("helius_wallet_cursor_invalid");
 if(before&&pagination_token)fail("helius_wallet_cursor_conflict");
 if(typeof rpc!=="function")fail("helius_wallet_transport_unavailable");
 const options={transactionDetails:"full",sortOrder:"desc",limit,commitment,encoding:"jsonParsed",maxSupportedTransactionVersion:0,filters:{status:"any",tokenAccounts:"balanceChanged",...(before?{signature:{lt:before}}:{})},...(pagination_token?{paginationToken:pagination_token}:{})};
 const result=await rpc(runtime.rpc_url,"getTransactionsForAddress",[address,options],{timeoutMs:7500,maxBytes:8*1024*1024});
 if(!Array.isArray(result?.data)||result.data.length>limit||(result.paginationToken!==null&&result.paginationToken!==undefined&&!/^\d{1,15}:\d{1,10}$/.test(result.paginationToken)))fail("helius_wallet_response_invalid");
 const seen=new Set();let priorSlot=Number.MAX_SAFE_INTEGER;
 const rows=result.data.map(transaction=>{
   const signature=transaction.transaction?.signatures?.[0];
   if(!/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(signature||"")||seen.has(signature)||signature===before||!Number.isSafeInteger(transaction.slot)||transaction.slot<0||transaction.slot>priorSlot||!transaction.meta||!Object.hasOwn(transaction.meta,"err"))fail("helius_wallet_transaction_invalid");
   seen.add(signature);priorSlot=transaction.slot;cacheTransaction(signature,transaction,commitment,now);
   return {signature,slot:transaction.slot,blockTime:transaction.blockTime??null,err:transaction.meta.err,confirmationStatus:commitment,transaction};
 });
 return {rows,pagination_token:result.paginationToken||null,history_exhausted:result.paginationToken===null,provider:runtime.provider,includes_associated_token_accounts:true};
}
export async function loadHeliusWalletHistory(env,{address,limit=24,observation_mode="historical_backfill",now=Date.now()},{rpc}={}) {
 const page=await loadHeliusWalletPage(env,{address,limit,now},{rpc});
 const receivedAt=new Date(now).toISOString(),events=[];
 for(const row of page.rows)try {
   events.push(normalizeSolanaWalletTransaction({wallet_address:address,signature_record:row,transaction:row.transaction,provider:page.provider,finality:row.confirmationStatus,observation_mode,observed_at:receivedAt,received_at:receivedAt,decode_started_at:receivedAt,decoded_at:receivedAt}));
 }catch{ /* A decoding gap stays explicit; it is never counted as a trade. */ }
 if(page.rows.length&&!events.length)fail("helius_wallet_history_decode_unavailable");
 return {events,provider:page.provider,observation_mode,history_limit:limit,history_exhausted:page.history_exhausted,signatures_requested:page.rows.length,transactions_decoded:events.length,decode_partial:events.length!==page.rows.length,partial:!page.history_exhausted||events.length!==page.rows.length,includes_associated_token_accounts:true,pagination_token:page.pagination_token,provider_request_count:1};
}
