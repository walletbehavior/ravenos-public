import { CANONICAL_REWARD_ASSETS, RewardError } from "./customer_rewards.mjs";
import { moneyMicros, productFlags } from "./customer_product.mjs";
import { reconcileClaimOperation } from "./customer_reward_claims.mjs";
import { SOLANA_MAINNET_GENESIS_HASH } from "./customer_trade/operator_solana_canary.mjs";
import { BASE_EVM_CHAIN_PROFILE, ETHEREUM_EVM_CHAIN_PROFILE } from "./customer_trade/evm_chain_profiles.mjs";
const TRANSFER_TOPIC="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const topicAddress=(value)=>typeof value==="string"&&/^0x0{24}[0-9a-f]{40}$/i.test(value)?`0x${value.slice(-40).toLowerCase()}`:null;
async function rpc(env,chain,method,params,fetchImpl) {
  const profile=chain==="base"?BASE_EVM_CHAIN_PROFILE:ETHEREUM_EVM_CHAIN_PROFILE;
  const configured=chain==="solana"?env.RAVENOS_SOLANA_RPC_URL||env.SOLANA_RPC_URL||env.SOLANA_ALCHEMY_RPC_URL:env[`RAVENOS_${chain.toUpperCase()}_RPC_URL`]||env[`${profile.environment_prefix}_RPC_URL`];
  let url;try{url=new URL(configured);}catch{throw new RewardError("claim_verification_rpc_unavailable",503);}
  if(url.protocol!=="https:"||url.username||url.password)throw new RewardError("claim_verification_rpc_invalid",503);
  const response=await fetchImpl(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:AbortSignal.timeout(8000),redirect:"manual"});
  if(!response.ok)throw new RewardError("claim_verification_rpc_unavailable",503);
  const text=await response.text();
  if(!response.ok||text.length>1024*1024)throw new RewardError("claim_verification_rpc_unavailable",503);
  const result=JSON.parse(text);
  if(result.error||result.id!==1)throw new RewardError("claim_verification_rpc_unavailable",503);
  return result.result;
}
export async function verifyCanonicalClaimTransfer(env,input,{request=null,fetch_impl=globalThis.fetch}={}) {
  const {chain,token,from,to,transaction_hash:tx}=input;
  const asset=CANONICAL_REWARD_ASSETS[chain];
  if(!asset||token!==asset.token||from===to)throw new RewardError("claim_transfer_identity_invalid");
  const amount=moneyMicros(input.amount_micros);
  const call=request||((method,params)=>rpc(env,chain,method,params,fetch_impl));
  if(chain==="solana") {
    if(!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(tx))throw new RewardError("claim_transfer_signature_invalid");
    const [genesis,statuses]=await Promise.all([call("getGenesisHash",[]),call("getSignatureStatuses",[[tx],{searchTransactionHistory:true}])]);
    if(genesis!==SOLANA_MAINNET_GENESIS_HASH)throw new RewardError("claim_rpc_chain_mismatch");
    const status=statuses?.value?.[0];
    if(status?.err||status?.confirmationStatus!=="finalized")return {matched:false,finalized:false};
    const transaction=await call("getTransaction",[tx,{commitment:"finalized",encoding:"jsonParsed",maxSupportedTransactionVersion:0}]);
    if(!transaction||transaction.meta?.err!==null||transaction.transaction?.signatures?.[0]!==tx)return {matched:false,finalized:false};
    const keys=transaction.transaction?.message?.accountKeys;
    if(!Array.isArray(keys)||!keys.some(k=>k.pubkey===from&&k.signer===true))throw new RewardError("claim_treasury_signer_mismatch");
    const balances=(rows,owner)=>{
      if(!Array.isArray(rows))throw new RewardError("claim_balance_evidence_unavailable");
      const seen=new Set();let total=0n;
      for(const row of rows)if(row.mint===token&&row.owner===owner){if(seen.has(row.accountIndex)||row.uiTokenAmount?.decimals!==6||!/^\d{1,20}$/.test(row.uiTokenAmount?.amount||""))throw new RewardError("claim_balance_evidence_invalid");seen.add(row.accountIndex);total+=BigInt(row.uiTokenAmount.amount);}
      return total;
    };
    const destinationCredit=balances(transaction.meta.postTokenBalances,to)-balances(transaction.meta.preTokenBalances,to);
    const treasuryDebit=balances(transaction.meta.preTokenBalances,from)-balances(transaction.meta.postTokenBalances,from);
    return {matched:destinationCredit===amount&&treasuryDebit===amount,finalized:true,chain,token,transaction_hash:tx,amount_micros:amount.toString(),slot:transaction.slot,evidence:"finalized_canonical_usdc_owner_balance_deltas"};
  }
  if(!/^0x[0-9a-f]{64}$/.test(tx))throw new RewardError("claim_transfer_signature_invalid");
  const chainId=chain==="base"?8453n:1n;
  const [actualChain,receipt,finalized]=await Promise.all([call("eth_chainId",[]),call("eth_getTransactionReceipt",[tx]),call("eth_getBlockByNumber",["finalized",false])]);
  if(BigInt(actualChain)!==chainId)throw new RewardError("claim_rpc_chain_mismatch");
  if(!receipt||!finalized||BigInt(receipt.blockNumber)>BigInt(finalized.number))return {matched:false,finalized:false};
  const block=await call("eth_getBlockByNumber",[receipt.blockNumber,false]);
  if(block?.hash!==receipt.blockHash||receipt.transactionHash!==tx||receipt.from?.toLowerCase()!==from||BigInt(receipt.status)!==1n)return {matched:false,finalized:false};
  const transfers=(receipt.logs||[]).filter(log=>!log.removed&&log.address?.toLowerCase()===token&&log.topics?.length===3&&log.topics[0]===TRANSFER_TOPIC&&topicAddress(log.topics[1])===from&&topicAddress(log.topics[2])===to);
  const matched=transfers.length===1&&/^0x[0-9a-f]{64}$/i.test(transfers[0].data)&&BigInt(transfers[0].data)===amount;
  return {matched,finalized:true,chain,token,transaction_hash:tx,amount_micros:amount.toString(),block_hash:receipt.blockHash,evidence:"finalized_canonical_usdc_transfer_log"};
}
export async function runRewardPayoutDispatcher(env,{limit=10,verify_transfer=null,treasury,now=Math.floor(Date.now()/1000)}={}) {
  if(!productFlags(env).claims||!env.RAVENOS_REWARDS_TREASURY?.fetch)return {state:"disabled"};
  const db=env.RAVENOS_CUSTOMER_DB;
  const rows=await db.prepare("SELECT * FROM ravenos_reward_operations WHERE kind='claim' AND state IN ('reserved','processing','indeterminate') ORDER BY updated_at,created_at,operation_id LIMIT ?").bind(Math.max(1,Math.min(20,limit))).all();
  const results=[];
  for(const operation of rows.results||[]) {
    try {results.push(await reconcileClaimOperation(env,operation,{now,treasury,verify_transfer:verify_transfer||(input=>verifyCanonicalClaimTransfer(env,input))}));}
    catch(error){results.push({operation_id:operation.operation_id,state:"reconciliation_pending",reason:error instanceof RewardError?error.code:"payout_unavailable"});}
    finally {await db.prepare("UPDATE ravenos_reward_operations SET updated_at=? WHERE operation_id=? AND state IN ('reserved','processing','indeterminate')").bind(now,operation.operation_id).run();}
  }
  return {state:"completed",operations:results};
}
