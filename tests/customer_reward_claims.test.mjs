import test from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { privateKeyToAccount } from "viem/accounts";
import { earn,rewardFixture,NOW,USER,OTHER } from "./customer_rewards_ledger.test.mjs";
import { CANONICAL_REWARD_ASSETS,rewardBalance } from "../lib/customer_rewards.mjs";
import { rewardClaimPolicy,validateClaimEconomics,createRewardWalletChallenge,verifyRewardWalletChallenge,resolveClaimDestination,requestCashbackClaim,reconcileClaimOperation } from "../lib/customer_reward_claims.mjs";
import { verifyCanonicalClaimTransfer } from "../lib/customer_reward_payouts.mjs";
const PRINCIPAL={user_id:USER,session_public_id:"fixture_session",authenticated_at:NOW};
async function claimFixture(chain="solana",kind="external_connected") {
 const f=await earn(rewardFixture({amount:"100000000"}));
 const sol=nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(42));
 const evm=privateKeyToAccount("0x"+"11".repeat(32));
 const wallet=chain==="solana"?bs58.encode(sol.publicKey):evm.address.toLowerCase();
 const treasuryWallet=chain==="solana"?bs58.encode(nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(24)).publicKey):"0x"+"22".repeat(20);
 const policy={enabled:true,token:CANONICAL_REWARD_ASSETS[chain].token,treasury_wallet:treasuryWallet,minimum_claim_micros:"5000000",maximum_network_cost_micros:"100000",maximum_cost_bps:200,network_cost_policy:"raven_absorbs"};
 f.env.RAVENOS_PRO_CASHBACK_CLAIMS_ENABLED="1";f.env.RAVENOS_REWARD_CLAIM_NETWORKS_JSON=JSON.stringify({[chain]:policy});
 let destination;
 if(kind==="external_connected") {
   const challenge=await createRewardWalletChallenge(f.db,PRINCIPAL,{chain,address:wallet,now:NOW});
   const signature=chain==="solana"?bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message),sol.secretKey)):await evm.signMessage({message:challenge.message});
   const proof=await verifyRewardWalletChallenge(f.db,PRINCIPAL,{challenge_id:challenge.challenge_id,signature,now:NOW});
   destination={kind,chain,verification_id:proof.verification_id};
 } else {
   f.db.raw.prepare("INSERT INTO ravenos_user_privy_identities(raven_user_id,privy_user_id,linked_at,last_verified_at,updated_at) VALUES (?,'did:privy:fixtureuser',?,?,?)").run(USER,NOW,NOW,NOW);
   f.db.raw.prepare("INSERT INTO ravenos_privy_wallets(wallet_record_id,raven_user_id,privy_user_id,ecosystem,public_address,created_at,last_verified_at,updated_at) VALUES (?,?,'did:privy:fixtureuser',?,?,?,?,?)").run("rpw_"+"a".repeat(32),USER,chain==="solana"?"solana":"evm",wallet,NOW,NOW,NOW);
   destination={kind,chain,wallet_record_id:"rpw_"+"a".repeat(32)};
 }
 const calls=[];
 const treasury=async(_env,path,payload)=>{calls.push({path,payload});assert.equal(path,"quote");return {ok:true,quote_id:"quote_fixture",chain,token:policy.token,wallet_address:wallet,treasury_wallet:treasuryWallet,amount_micros:payload.amount_micros,network_cost_micros:"10000",spendable_usdc_micros:"1000000000",expires_at:NOW+60};};
 const input={amount_micros:"10000000",idempotency_key:"claim_request_1234",destination};
 return {...f,chain,policy,sol,evm,wallet,treasuryWallet,destination,input,treasury,calls};
}
for(const chain of ["solana","base","ethereum"])test(`${chain} external-wallet claim requires a signature and reserves canonical USDC`,async()=>{
 const f=await claimFixture(chain);const result=await requestCashbackClaim(f.env,PRINCIPAL,f.input,{now:NOW,treasury:f.treasury});assert.equal(result.state,"reserved");assert.equal(result.destination.token,CANONICAL_REWARD_ASSETS[chain].token);assert.equal((await rewardBalance(f.db,USER)).claimed_micros,"0");assert.equal(f.calls.every(c=>c.path==="quote"),true);
});
for(const chain of ["solana","base"])test(`${chain} Privy claim is isolated to the authenticated Raven account`,async()=>{
 const f=await claimFixture(chain,"privy_embedded");assert.equal((await resolveClaimDestination(f.db,PRINCIPAL,f.destination,{now:NOW})).wallet_address,f.wallet);await assert.rejects(resolveClaimDestination(f.db,{...PRINCIPAL,user_id:OTHER},f.destination,{now:NOW}),/verification_required/);
 f.db.raw.exec("UPDATE ravenos_user_privy_identities SET state='unlinked'");await assert.rejects(resolveClaimDestination(f.db,PRINCIPAL,f.destination,{now:NOW}),/verification_required/);
});
test("an external proof is bound to user, session, chain, destination, and expiry",async()=>{const f=await claimFixture();for(const principal of [{...PRINCIPAL,user_id:OTHER},{...PRINCIPAL,session_public_id:"other"}])await assert.rejects(resolveClaimDestination(f.db,principal,f.destination,{now:NOW}),/verification_required/);await assert.rejects(resolveClaimDestination(f.db,PRINCIPAL,{...f.destination,chain:"base"},{now:NOW}),/verification_required/);await assert.rejects(resolveClaimDestination(f.db,PRINCIPAL,f.destination,{now:NOW+301}),/verification_required/);});
test("claims cannot use arbitrary unverified destination strings",async()=>{const f=await claimFixture();await assert.rejects(requestCashbackClaim(f.env,PRINCIPAL,{...f.input,destination:{chain:"solana",wallet_address:f.wallet}},{now:NOW,treasury:f.treasury}),/verified_wallet/);});
test("consumed external proof cannot authorize a second claim",async()=>{const f=await claimFixture();await requestCashbackClaim(f.env,PRINCIPAL,f.input,{now:NOW,treasury:f.treasury});await assert.rejects(requestCashbackClaim(f.env,PRINCIPAL,{...f.input,idempotency_key:"claim_second_1234"},{now:NOW,treasury:f.treasury}),/verification_required/);const retry=await requestCashbackClaim(f.env,PRINCIPAL,f.input,{now:NOW,treasury:f.treasury});assert.equal(retry.state,"reserved");assert.equal((await rewardBalance(f.db,USER)).reserved_micros,"10000000");});
test("simultaneous use of one external proof cannot reserve twice",async()=>{const f=await claimFixture();const results=await Promise.allSettled([requestCashbackClaim(f.env,PRINCIPAL,f.input,{now:NOW,treasury:f.treasury}),requestCashbackClaim(f.env,PRINCIPAL,{...f.input,idempotency_key:"claim_second_1234"},{now:NOW,treasury:f.treasury})]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal((await rewardBalance(f.db,USER)).reserved_micros,"10000000");});
test("configured minimum and measured network cost control claim economics",async()=>{const f=await claimFixture();const policy=rewardClaimPolicy(f.env,"solana");assert.throws(()=>validateClaimEconomics(policy,"4999999","1000"),/below_minimum/);assert.throws(()=>validateClaimEconomics(policy,"5000000","100001"),/cost_too_high/);assert.equal(validateClaimEconomics(policy,"5000000","10000").user_network_cost_micros,"0");});
test("bridged USDC and unconfigured networks cannot be selected",async()=>{const f=await claimFixture();assert.throws(()=>rewardClaimPolicy(f.env,"bsc"),/unavailable/);f.env.RAVENOS_REWARD_CLAIM_NETWORKS_JSON=JSON.stringify({solana:{...f.policy,token:"USDC.e"}});assert.throws(()=>rewardClaimPolicy(f.env,"solana"),/unavailable/);});
test("claims fail closed on stale or absent recent authentication",async()=>{const f=await claimFixture();for(const time of [undefined,NOW-901,NOW+1000])await assert.rejects(requestCashbackClaim(f.env,{...PRINCIPAL,authenticated_at:time},f.input,{now:NOW,treasury:f.treasury}),/recent_login/);});
test("claim cannot exceed available balance or spend pending rewards",async()=>{const f=await claimFixture();await assert.rejects(requestCashbackClaim(f.env,PRINCIPAL,{...f.input,amount_micros:"30000001"},{now:NOW,treasury:f.treasury}),/balance_insufficient/);assert.equal(f.calls.length,0);});
test("treasury quote must prove exact asset, destination, amount and funding",async()=>{const f=await claimFixture();for(const override of [{token:"wrong"},{wallet_address:f.treasuryWallet},{amount_micros:"1"},{spendable_usdc_micros:"1"}])await assert.rejects(requestCashbackClaim(f.env,PRINCIPAL,f.input,{now:NOW,treasury:async(...args)=>({...await f.treasury(...args),...override})}),/mismatch|funding/);});
test("a submitted claim settles only after independent finalized transfer evidence",async()=>{
 const f=await claimFixture();const result=await requestCashbackClaim(f.env,PRINCIPAL,f.input,{now:NOW,treasury:f.treasury});let operation=f.db.raw.prepare("SELECT * FROM ravenos_reward_operations WHERE operation_id=?").get(result.operation_id);let submits=0;
 const treasury=async()=>{submits++;return {transaction_hash:"5".repeat(88)};};
 await reconcileClaimOperation(f.env,operation,{now:NOW,treasury,verify_transfer:async()=>({matched:true,finalized:false})});assert.equal((await rewardBalance(f.db,USER)).claimed_micros,"0");
 operation=f.db.raw.prepare("SELECT * FROM ravenos_reward_operations WHERE operation_id=?").get(result.operation_id);
 await reconcileClaimOperation(f.env,operation,{now:NOW+1,treasury,verify_transfer:async()=>({matched:true,finalized:true})});assert.equal(submits,1);assert.equal((await rewardBalance(f.db,USER)).claimed_micros,"10000000");
});
test("Base independent receipt verifier rejects wrong chain, asset or transfer amount",async()=>{
 const from="0x"+"22".repeat(20),to="0x"+"33".repeat(20),tx="0x"+"44".repeat(32),token=CANONICAL_REWARD_ASSETS.base.token;
 const receipt={blockNumber:"0x10",blockHash:"0xblock",transactionHash:tx,from,status:"0x1",logs:[{address:token,topics:["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef","0x"+"0".repeat(24)+from.slice(2),"0x"+"0".repeat(24)+to.slice(2)],data:"0x"+(10000000n).toString(16).padStart(64,"0")} ]};
 const request=async(method,params)=>method==="eth_chainId"?"0x2105":method==="eth_getTransactionReceipt"?receipt:params[0]==="finalized"?{number:"0x20"}:{hash:"0xblock"};
 const input={chain:"base",token,from,to,transaction_hash:tx,amount_micros:"10000000"};assert.equal((await verifyCanonicalClaimTransfer({},input,{request})).matched,true);
 assert.equal((await verifyCanonicalClaimTransfer({},{...input,amount_micros:"10000001"},{request})).matched,false);
 await assert.rejects(verifyCanonicalClaimTransfer({},input,{request:async(method,params)=>method==="eth_chainId"?"0x1":request(method,params)}),/chain_mismatch/);
});
test("Solana claim verifier requires finalized mainnet USDC credit and the exact treasury debit",async()=>{
 const from=bs58.encode(nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(4)).publicKey);
 const to=bs58.encode(nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(5)).publicKey);
 const tx="5".repeat(88),token=CANONICAL_REWARD_ASSETS.solana.token;
 const balance=(owner,amount,index)=>({owner,mint:token,accountIndex:index,uiTokenAmount:{amount,decimals:6}});
 const transaction={slot:42,transaction:{signatures:[tx],message:{accountKeys:[{pubkey:from,signer:true}]}},meta:{err:null,preTokenBalances:[balance(from,"20000000",0)],postTokenBalances:[balance(from,"10000000",0),balance(to,"10000000",1)]}};
 const request=async method=>method==="getGenesisHash"?"5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d":method==="getSignatureStatuses"?{value:[{err:null,confirmationStatus:"finalized"}]}:structuredClone(transaction);
 const input={chain:"solana",token,from,to,transaction_hash:tx,amount_micros:"10000000"};
 assert.equal((await verifyCanonicalClaimTransfer({},input,{request})).matched,true);
 transaction.meta.postTokenBalances[0].uiTokenAmount.amount="11000000";
 assert.equal((await verifyCanonicalClaimTransfer({},input,{request})).matched,false);
 await assert.rejects(verifyCanonicalClaimTransfer({},input,{request:async method=>method==="getGenesisHash"?"devnet":request(method)}),/chain_mismatch/);
 assert.equal((await verifyCanonicalClaimTransfer({},input,{request:async method=>method==="getSignatureStatuses"?{value:[{err:null,confirmationStatus:"confirmed"}]}:request(method)})).finalized,false);
});
