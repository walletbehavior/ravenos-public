import test from "node:test";
import assert from "node:assert/strict";
import bs58 from "bs58";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createD1CustomerWalletCopyStore, persistSourceWalletProfile } from "../lib/customer_wallet_copy.mjs";
import { createSourceWalletId } from "../lib/customer_trade/source_wallet_chain_identity.mjs";
import { heliusWalletHistoryRuntime,loadHeliusWalletPage,loadHeliusWalletHistory,cachedHeliusWalletTransaction } from "../lib/customer_trade/helius_wallet_history.mjs";
import { alchemyWalletHistoryRuntime,loadAlchemyWalletInputs } from "../lib/customer_trade/alchemy_wallet_history.mjs";
import { inspectEvmWallet } from "../lib/customer_trade/evm_wallet_lookup.mjs";
const WALLET=bs58.encode(new Uint8Array(32).fill(7)),TOKEN=bs58.encode(new Uint8Array(32).fill(9)),USDC="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",SIG=bs58.encode(new Uint8Array(64).fill(4));
const heliusEnv={RAVENOS_HELIUS_WALLET_HISTORY_ENABLED:"1",HELIUS_API_KEY:"fixture-never-public"};
function solTransaction(){return {slot:100,blockTime:1788739199,transaction:{signatures:[SIG],message:{accountKeys:[{pubkey:WALLET,signer:true}],instructions:[{programId:"JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"}]}},meta:{err:null,fee:5000,preBalances:[1000000000],postBalances:[999995000],preTokenBalances:[{owner:WALLET,mint:USDC,uiTokenAmount:{amount:"10000000",decimals:6}},{owner:WALLET,mint:TOKEN,uiTokenAmount:{amount:"0",decimals:6}}],postTokenBalances:[{owner:WALLET,mint:USDC,uiTokenAmount:{amount:"5000000",decimals:6}},{owner:WALLET,mint:TOKEN,uiTokenAmount:{amount:"10000000",decimals:6}}],innerInstructions:[],logMessages:["Program log: Instruction: Route"]}};}
test("Helius returns full ATA-aware history in one bounded request and reuses hydrated transactions",async()=>{let calls=0;const result=await loadHeliusWalletHistory(heliusEnv,{address:WALLET,limit:24,now:1788739200000},{rpc:async(url,method,params)=>{calls++;assert.equal(new URL(url).hostname,"mainnet.helius-rpc.com");assert.equal(method,"getTransactionsForAddress");assert.equal(params[1].filters.tokenAccounts,"balanceChanged");assert.equal(params[1].transactionDetails,"full");return {data:[solTransaction()],paginationToken:null};}});assert.equal(calls,1);assert.equal(result.events[0].classification.kind,"SWAP_BUY");assert.equal(result.history_exhausted,true);assert.equal(result.includes_associated_token_accounts,true);assert.equal(cachedHeliusWalletTransaction(SIG,"confirmed",1788739200000).slot,100);assert.equal(cachedHeliusWalletTransaction(SIG,"finalized",1788739200000),null);assert.ok(!JSON.stringify(result).includes("fixture-never-public"));});
test("Helius continuation and incomplete history remain explicit",async()=>{const result=await loadHeliusWalletPage(heliusEnv,{address:WALLET,limit:1},{rpc:async()=>({data:[solTransaction()],paginationToken:"100:1"})});assert.equal(result.history_exhausted,false);assert.equal(result.pagination_token,"100:1");await assert.rejects(loadHeliusWalletPage(heliusEnv,{address:WALLET,before:SIG,pagination_token:"100:1"},{rpc:async()=>{throw new Error();}}),/cursor_conflict/);});
test("Helius normalized history persists in the production store and becomes reusable wallet analytics", async () => {
 const db = new DatabaseSync(":memory:");
 try {
  for (const name of readdirSync("customer-migrations").filter(name => /^\d+.*\.sql$/.test(name)).sort()) db.exec(readFileSync(`customer-migrations/${name}`, "utf8"));
  const adapter = { prepare(sql) {
   const statement = (params = []) => ({ bind: (...values) => statement(values),
    first: async () => db.prepare(sql).get(...params) || null,
    all: async () => ({results:db.prepare(sql).all(...params)}),
    run: async () => ({meta:{changes:Number(db.prepare(sql).run(...params).changes)}}) });
   return statement();
  }};
  const store = createD1CustomerWalletCopyStore(adapter), now = 1788739200;
  const sourceId = createSourceWalletId({chain:"solana",network:"mainnet",address:WALLET});
  const loaded = await loadHeliusWalletHistory(heliusEnv,{address:WALLET,now:now*1000},{rpc:async()=>({data:[solTransaction()],paginationToken:null})});
  await store.upsertSourceWallet({source_wallet_id:sourceId,address:WALLET,now});
  assert.deepEqual(await store.recordEvents(sourceId,loaded.events,now),[loaded.events[0].event_id]);
  assert.deepEqual(await store.recordEvents(sourceId,loaded.events,now),[]);
  const profile = await persistSourceWalletProfile(store,sourceId,now,loaded);
  assert.equal(profile.source_wallet.address,WALLET);
  assert.equal(profile.behavior.trade_count,1);
  assert.equal((await store.walletIndexCoverage()).chains[0].indexed_wallets,1);
  assert.equal((await store.latestProfile(sourceId)).generated_at,profile.generated_at);
  const event=loaded.events[0];
  for(const bad of [
   {...event,source_wallet_id:"sw_solana_mismatched"},
   {...event,source_wallet:{...event.source_wallet,address:TOKEN}},
   {...event,source_wallet:{...event.source_wallet,network:"devnet"}},
   {...event,source_wallet:{...event.source_wallet,chain:"robinhood"}},
  ]) await assert.rejects(store.recordEvents(sourceId,[bad],now),/wallet_source_event_invalid/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ravenos_source_wallet_events").get().n,1);
 } finally { db.close(); }
});
test("Helius rejects duplicate records, mismatched ordering and unsafe endpoint configuration",async()=>{assert.equal(heliusWalletHistoryRuntime({...heliusEnv,RAVENOS_HELIUS_RPC_URL:"https://evil.example/?api-key=x"}).enabled,false);await assert.rejects(loadHeliusWalletPage(heliusEnv,{address:WALLET,limit:2},{rpc:async()=>({data:[solTransaction(),solTransaction()],paginationToken:null})}),/transaction_invalid/);});
const EVM="0x"+"33".repeat(20),COUNTER="0x"+"44".repeat(20),CONTRACT="0x"+"55".repeat(20),TX="0x"+"66".repeat(32),BLOCK="0x"+"77".repeat(32);
function alchemyFixture(chain="base") {
 const ids={base:8453,ethereum:1,bsc:56,robinhood:4663},hosts={base:"base-mainnet",ethereum:"eth-mainnet",bsc:"bnb-mainnet",robinhood:"robinhood-mainnet"};
 const env={RAVENOS_EVM_WALLET_LOOKUP_ENABLED:"1",RAVENOS_ALCHEMY_WALLET_HISTORY_ENABLED:"1",[`ALCHEMY_${chain==="ethereum"?"ETH":chain.toUpperCase()}_RPC_URL`]:`https://${hosts[chain]}.g.alchemy.com/v2/fixture-server-key`};
 const calls=[];const transfer={hash:TX,uniqueId:TX+":log:0",blockNum:"0x10",from:COUNTER,to:EVM,category:"erc20",rawContract:{address:CONTRACT,value:"0xf4240",decimal:"0x6"},metadata:{blockTimestamp:"2026-09-06T00:00:00Z"}};
 const fetchImpl=async(url,init)=>{const {method,params}=JSON.parse(init.body);calls.push(method);let result;
 if(method==="eth_chainId")result="0x"+ids[chain].toString(16);
 else if(method==="alchemy_getAssetTransfers")result={transfers:params[0].toAddress?[transfer]:[],pageKey:null};
 else if(method==="alchemy_getTokenBalances")result={address:EVM,tokenBalances:[{contractAddress:CONTRACT,tokenBalance:"0xf4240"}]};
 else if(method==="eth_getBalance")result="0x1bc16d674ec80000";
 else if(method==="alchemy_getTokenMetadata")result={symbol:"TEST",name:"Test token",decimals:6};
 else if(method==="eth_getTransactionReceipt")result={transactionHash:TX,blockHash:BLOCK,blockNumber:"0x10",status:"0x1",logs:[{address:CONTRACT,logIndex:"0x0",topics:["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef","0x"+"0".repeat(24)+COUNTER.slice(2),"0x"+"0".repeat(24)+EVM.slice(2)],data:"0x"+1000000n.toString(16).padStart(64,"0")} ]};
 else throw new Error(`Unexpected ${method}`);
 return Response.json({jsonrpc:"2.0",id:1,result});};
 return {env,fetchImpl,calls};
}
for(const chain of ["base","ethereum","bsc","robinhood"])test(`Alchemy ${chain} keeps exact chain and wallet ownership with receipt-backed transfers`,async()=>{const f=alchemyFixture(chain);const inputs=await loadAlchemyWalletInputs(f.env,chain,EVM,{fetchImpl:f.fetchImpl});assert.equal(inputs.transfersPayload.items[0].total.value,"1000000");assert.equal(inputs.tokensPayload.items[0].value,"1000000");const result=await inspectEvmWallet({chain,address:EVM,env:f.env,fetchImpl:f.fetchImpl,now:"2026-09-06T00:01:00Z"});assert.equal(result.source.provider,"alchemy_wallet_history");assert.equal(result.profile.source_wallet.chain,chain);assert.equal(result.recent_events[0].classification.kind,"TRANSFER_IN");assert.equal(result.profile.source_performance.realized_pnl_usdc,null);assert.equal(result.profile.evidence_boundary.transfers_treated_as_trades,false);assert.ok(!JSON.stringify(result).includes("fixture-server-key"));});
test("Alchemy chain mismatch fails before any wallet methods",async()=>{const f=alchemyFixture();let calls=0;await assert.rejects(loadAlchemyWalletInputs(f.env,"base",EVM,{fetchImpl:async()=>{calls++;return Response.json({id:1,result:"0x1"});}}),/chain_mismatch/);assert.equal(calls,1);});
test("Alchemy method restrictions stay unavailable rather than reporting empty complete history",async()=>{const f=alchemyFixture();const result=await loadAlchemyWalletInputs(f.env,"base",EVM,{fetchImpl:async(url,init)=>JSON.parse(init.body).method==="alchemy_getAssetTransfers"?Response.json({id:1,error:{code:-32601}}):f.fetchImpl(url,init)});assert.equal(result.partial,true);assert.equal(result.transfersPayload.items.length,0);assert.equal(alchemyWalletHistoryRuntime({...f.env,ALCHEMY_BASE_RPC_URL:"https://eth-mainnet.g.alchemy.com/v2/key"},"base").enabled,false);});
