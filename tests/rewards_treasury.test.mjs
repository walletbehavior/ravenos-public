import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { Keypair, Transaction, PublicKey } from '@solana/web3.js';
import { claimTransaction, constructClaim, verifySignedClaim, privySignClaim, tokenAccount, canonicalJson, readSolValue, solanaRpc, treasuryConfig } from '../services/rewards-treasury/solana.mjs';
import { RewardsTreasury, reservedClaim } from '../services/rewards-treasury/worker.mjs';
import { CANONICAL_REWARD_ASSETS, reserveRewards } from '../lib/customer_rewards.mjs';
import { SOLANA_MAINNET_GENESIS_HASH } from '../lib/customer_trade/operator_solana_canary.mjs';
import { earn, rewardFixture, NOW, USER, OTHER } from './customer_rewards_ledger.test.mjs';

const treasury=Keypair.fromSeed(new Uint8Array(32).fill(61)), recipient=Keypair.fromSeed(new Uint8Array(32).fill(62));
const wallet=treasury.publicKey.toBase58(), destination=recipient.publicKey.toBase58();
const mint=CANONICAL_REWARD_ASSETS.solana.token, token='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const blockhash=Keypair.fromSeed(new Uint8Array(32).fill(63)).publicKey.toBase58();
const policy={wallet_address:wallet,minimum_claim_micros:'5000000',maximum_claim_micros:'100000000',daily_limit_micros:'15000000',maximum_network_cost_micros:'500000',maximum_cost_bps:500,sol_price_ceiling_micros:'150000000'};
const env={TREASURY_POLICY_JSON:JSON.stringify({...policy,maximum_claim_micros:'15000000'}),TREASURY_LIVE_ENABLED:'1',TREASURY_QUOTES_ENABLED:'1'};
const input={operation_id:'rop_'+'a'.repeat(64),user_id:USER,amount_micros:'10000000',destination:{kind:'privy_embedded',wallet_record_id:'rpw_fixture_treasury_wallet',chain:'solana',token:mint,wallet_address:destination,treasury_wallet:wallet,quote_id:'rtq_fixture'}};
function account(owner,amount=100000000n) {
  const data=Buffer.alloc(165);new PublicKey(mint).toBuffer().copy(data);new PublicKey(owner).toBuffer().copy(data,32);data.writeBigUInt64LE(amount,64);data[108]=1;
  return {owner:token,executable:false,data:[data.toString('base64'),'base64']};
}
function rpcFixture(overrides={}) {
  const calls=[];
  const values={getGenesisHash:SOLANA_MAINNET_GENESIS_HASH,getLatestBlockhash:{value:{blockhash,lastValidBlockHeight:200}},getMultipleAccounts:{value:[account(wallet),null]},getBalance:{value:100000000},getFeeForMessage:{value:5000},getMinimumBalanceForRentExemption:2039280,getBlockHeight:100,getSignatureStatuses:{value:[null]},...overrides};
  return {calls,values,request:async(method,params)=>{calls.push({method,params});if(!(method in values))throw Error('unexpected_rpc_'+method);return typeof values[method]==='function'?values[method](params):values[method];}};
}
const valuation=async()=>({amount_micros:'140000000',observed_at:NOW,source:'fixture'});
async function prepared(overrides={}) { const rpc=rpcFixture(overrides);return {...await constructClaim(env,input,{now:NOW,request:rpc.request,valuation}),rpc}; }
function signed(value) { const tx=Transaction.from(Buffer.from(value.unsigned_transaction,'base64'));tx.sign(treasury);return {signed_transaction:tx.serialize().toString('base64')}; }
class MemoryStorage {
  constructor(){this.rows=new Map();this.alarms=[];}
  async get(key){return structuredClone(this.rows.get(key));}
  async delete(key){return this.rows.delete(key);}
  async put(key,value){if(typeof key==='string')this.rows.set(key,structuredClone(value));else for(const [name,row]of Object.entries(key))this.rows.set(name,structuredClone(row));}
  async list({prefix}){return new Map([...this.rows].filter(([key])=>key.startsWith(prefix)).map(([key,row])=>[key,structuredClone(row)]));}
  async setAlarm(at){this.alarms.push(at);}
}
async function dispatcher(overrides={}) {
  const {rpc: constructionRpc,...quote}=await prepared(), storage=new MemoryStorage(), calls={build:0,sign:0,load:0,sends:[]};
  const request=rpcFixture();request.values.sendTransaction=params=>{calls.sends.push(params[0]);return verifySignedClaim(quote.unsigned_transaction,params[0],wallet).transaction_hash;};
  const dependencies={now:()=>NOW,build:async()=>{calls.build++;return quote;},sign:async value=>{calls.sign++;return signed(value);},load:async()=>{calls.load++;return {state:'reserved'};},rpc:request.request,...overrides};
  return {service:new RewardsTreasury({storage},env,dependencies),storage,calls,quote,request};
}
test('canonical USDC construction measures fee plus missing ATA rent and rounds upward',async()=>{
  const quote=await prepared();assert.equal(quote.network_cost_lamports,'2044280');assert.equal(quote.network_cost_micros,'306642');
  const tx=Transaction.from(Buffer.from(quote.unsigned_transaction,'base64'));assert.equal(tx.instructions.length,3);
  assert.equal(tx.instructions[0].data[0],1);assert.equal(tx.instructions[1].programId.toBase58(),token);assert.equal(tx.instructions[1].data[0],12);assert.equal(tx.instructions[1].data.readBigUInt64LE(1),10000000n);assert.equal(tx.instructions[1].data[9],6);
  assert.equal(tx.instructions[1].keys[2].pubkey.toBase58(),tokenAccount(destination).toBase58());
  assert.equal(quote.rpc.calls.some(row=>/send|sign/.test(row.method)),false);
});
test('two separate equal-value claims cannot collapse into the same on-chain transaction',()=>{
  const args={treasury:wallet,destination,amount:10000000n,blockhash,create_destination:false};
  const a=claimTransaction({...args,operation_id:'rop_'+'a'.repeat(64)}),b=claimTransaction({...args,operation_id:'rop_'+'b'.repeat(64)});
  a.sign(treasury);b.sign(treasury);assert.notDeepEqual(a.signature,b.signature);
});
test('existing canonical destination omits rent without inventing minimum economics',async()=>{const quote=await prepared({getMultipleAccounts:{value:[account(wallet),account(destination)]}});assert.equal(quote.network_cost_lamports,'5000');assert.equal(quote.network_cost_micros,'750');assert.equal(quote.rpc.calls.some(row=>row.method==='getMinimumBalanceForRentExemption'),false);});
test('wrong chain, mint, frozen/delegated accounts, balance and network valuation fail closed',async()=>{
  const bad=account(wallet);const data=Buffer.from(bad.data[0],'base64');data[108]=2;bad.data[0]=data.toString('base64');
  for(const override of [{getGenesisHash:'devnet'},{getMultipleAccounts:{value:[bad,null]}},{getMultipleAccounts:{value:[account(destination),null]}},{getMultipleAccounts:{value:[account(wallet,1n),null]}},{getBalance:{value:1}}])await assert.rejects(prepared(override),/treasury_/);
  await assert.rejects(constructClaim(env,{...input,destination:{...input.destination,token:'USDC.e'}},{now:NOW,valuation}),/destination_invalid/);
  await assert.rejects(constructClaim(env,input,{now:NOW,request:rpcFixture().request,valuation:async()=>({...await valuation(),observed_at:NOW-91})}),/valuation_out_of_policy/);
  await assert.rejects(constructClaim(env,{...input,amount_micros:'1'},{now:NOW,valuation}),/amount_out_of_policy/);
});
test('signed payout must contain exactly the constructed message and treasury signature',async()=>{
  const quote=await prepared(), good=signed(quote);assert.ok(verifySignedClaim(quote.unsigned_transaction,good.signed_transaction,wallet).transaction_hash);
  const changed=claimTransaction({treasury:wallet,destination,amount:1n,blockhash,create_destination:true});changed.sign(treasury);
  assert.throws(()=>verifySignedClaim(quote.unsigned_transaction,changed.serialize().toString('base64'),wallet),/mismatch/);
  assert.throws(()=>verifySignedClaim(quote.unsigned_transaction,quote.unsigned_transaction,wallet),/mismatch/);
});
test('Privy adapter signs only signTransaction using P-256 authorization and verifies returned wire',async()=>{
  const quote=await prepared(), pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}), secret='test-only-app-secret';
  const config={...env,TREASURY_PRIVY_WALLET_ID:'fixturewallet123',TREASURY_PRIVY_APP_ID:'fixtureapp123',TREASURY_PRIVY_APP_SECRET:secret,TREASURY_PRIVY_AUTHORIZATION_KEY:pair.privateKey.export({type:'pkcs8',format:'pem'})};
  const result=await privySignClaim(config,quote,{now:NOW*1000,fetch_impl:async(url,init)=>{
    assert.equal(url,'https://api.privy.io/v1/wallets/fixturewallet123/rpc');assert.equal(init.redirect,'manual');const body=JSON.parse(init.body);assert.equal(body.method,'signTransaction');
    const headers=Object.fromEntries(Object.entries(init.headers).filter(([key])=>key.startsWith('privy-')&&key!=='privy-authorization-signature'));
    assert.equal(verify('sha256',Buffer.from(canonicalJson({version:1,method:'POST',url,body,headers})),pair.publicKey,Buffer.from(init.headers['privy-authorization-signature'],'base64')),true);
    return Response.json({method:'signTransaction',data:{...{signed_transaction:signed(quote).signed_transaction},encoding:'base64'}});
  }});assert.ok(result.transaction_hash);
  await assert.rejects(privySignClaim({...config,TREASURY_LIVE_ENABLED:'0'},quote),/live_disabled/);
  await assert.rejects(privySignClaim(config,quote,{fetch_impl:async()=>new Response('',{status:302})}),/unavailable/);
});
test('SOL valuation verifies price slot freshness and uses integer upward rounding',async()=>{
  const mint='So11111111111111111111111111111111111111112', prices={ [mint]:{usdPrice:140.00000001,blockId:100,decimals:9}};
  const read=fetch_impl=>readSolValue({TREASURY_JUPITER_API_KEY:'test-key'},async()=>NOW,{now:NOW,fetch_impl});
  const value=await read(async(_url,init)=>{assert.equal(init.redirect,'manual');return Response.json(prices);});assert.equal(value.amount_micros,'140000001');
  await assert.rejects(readSolValue({TREASURY_JUPITER_API_KEY:'test-key'},async()=>NOW-100,{now:NOW,fetch_impl:async()=>Response.json(prices)}),/stale/);
  await assert.rejects(read(async()=>new Response('',{status:302})),/unavailable/);
});
test('RPC redirects and provider credential-bearing errors are never forwarded',async()=>{
  await assert.rejects(solanaRpc({TREASURY_SOLANA_RPC_URL:'https://rpc.example.test/private'},'getBalance',[],async(_url,init)=>{assert.equal(init.redirect,'manual');throw Error('private-rpc-secret');}),error=>error.message==='treasury_rpc_unavailable');
});
test('payout is persisted before sending; duplicate requests reuse one message and one signature',async()=>{
  const f=await dispatcher();f.request.values.sendTransaction=params=>{const stored=f.storage.rows.get('claim:'+input.operation_id);assert.equal(stored.signed_transaction,params[0]);assert.equal(stored.state,'processing');f.calls.sends.push(params[0]);return stored.transaction_hash;};
  const a=await f.service.payout(input), b=await f.service.payout(input);assert.equal(a.transaction_hash,b.transaction_hash);assert.equal(f.calls.build,1);assert.equal(f.calls.sign,1);assert.equal(f.calls.sends.length,1);
});
test('ambiguous broadcast resumes the same signed bytes after a durable service restart',async()=>{
  const f=await dispatcher();f.request.values.sendTransaction=params=>{f.calls.sends.push(params[0]);throw Error('timeout');};
  await f.service.payout(input);
  const restarted=new RewardsTreasury({storage:f.storage},env,{now:()=>NOW,rpc:f.request.request,load:async()=>({}),build:async()=>{throw Error('must_not_rebuild');},sign:async()=>{throw Error('must_not_resign');}});
  await restarted.alarm();assert.equal(f.calls.sends.length,2);assert.equal(f.calls.sends[0],f.calls.sends[1]);
});
test('kill switch prevents any signer or broadcast work and quote output contains no transaction',async()=>{
  const f=await dispatcher();f.service.env={...env,TREASURY_LIVE_ENABLED:'0'};await assert.rejects(f.service.payout(input),/live_disabled/);assert.equal(f.calls.sign,0);await f.service.alarm();assert.equal(f.calls.sends.length,0);
  const response=await f.service.fetch(new Request('https://raven-rewards-treasury.internal/quote',{method:'POST',body:JSON.stringify(input)}));const body=await response.json();assert.equal(body.ok,true);assert.equal('unsigned_transaction'in body,false);
});
test('expired signed transaction enters review; it is never rebuilt or sent with a new blockhash',async()=>{
  const f=await dispatcher();await f.service.payout(input);f.request.values.getBlockHeight=201;await f.service.alarm();assert.equal(f.storage.rows.get('claim:'+input.operation_id).state,'review_required');assert.equal(f.calls.sign,1);assert.equal(f.calls.sends.length,1);
});
test('durable daily budget prevents a second distinct payout and conflicting retry is refused',async()=>{
  const f=await dispatcher();await f.service.payout(input);await assert.rejects(f.service.payout({...input,operation_id:'rop_'+'b'.repeat(64)}),/daily_limit/);
  await assert.rejects(f.service.payout({...input,amount_micros:'11000000'}),/idempotency_conflict/);assert.equal(f.calls.sign,1);
});
test('service serializes simultaneous payout requests before consulting the signer',async()=>{
  const f=await dispatcher();const request=()=>new Request('https://raven-rewards-treasury.internal/payout',{method:'POST',body:JSON.stringify(input)});
  const replies=await Promise.all([f.service.fetch(request()),f.service.fetch(request())]);assert.ok(replies.every(r=>r.ok));assert.equal(f.calls.sign,1);
});
test('treasury independently verifies the existing reward ledger, owner and embedded wallet',async()=>{
  const f=await earn(rewardFixture({amount:'100000000'}));
  f.db.raw.prepare("INSERT INTO ravenos_user_privy_identities(raven_user_id,privy_user_id,linked_at,last_verified_at,updated_at) VALUES (?,'did:privy:treasurytest',?,?,?)").run(USER,NOW,NOW,NOW);
  f.db.raw.prepare("INSERT INTO ravenos_privy_wallets(wallet_record_id,raven_user_id,privy_user_id,ecosystem,public_address,created_at,last_verified_at,updated_at) VALUES ('rpw_fixture_treasury_wallet',?,'did:privy:treasurytest','solana',?,?,?,?)").run(USER,destination,NOW,NOW,NOW);
  const op=await reserveRewards(f.db,{user_id:USER,kind:'claim',amount_micros:input.amount_micros,idempotency_key:'treasury_fixture_request',destination:input.destination,now:NOW});
  const request={...input,operation_id:op.operation_id};assert.equal((await reservedClaim(f.db,request,treasuryConfig(env))).user_id,USER);
  await assert.rejects(reservedClaim(f.db,{...request,user_id:OTHER},treasuryConfig(env)),/reservation_unavailable/);
  await assert.rejects(reservedClaim(f.db,{...request,destination:{...request.destination,wallet_address:wallet}},treasuryConfig(env)),/destination_mismatch/);
  f.db.raw.exec("UPDATE ravenos_user_privy_identities SET state='unlinked'");await assert.rejects(reservedClaim(f.db,request,treasuryConfig(env)),/verification_unavailable/);
});
