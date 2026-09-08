import assert from "node:assert/strict";
import test from "node:test";
import { evmTokenApprovalContext } from "../lib/customer_trade/evm_token_approval.mjs";
import { EVM_CHAIN_PROFILES, EVM_ZERO_X_ALLOWANCE_HOLDER as SPENDER } from "../lib/customer_trade/evm_chain_profiles.mjs";
await import("../client/ravenos-wallet-execution-entry.js");
const WALLET = "0x3333333333333333333333333333333333333333", TOKEN = "0x1111111111111111111111111111111111111111", HASH = `0x${"a".repeat(64)}`;
function fixture(chain = "base", options = {}) {
  const profile = EVM_CHAIN_PROFILES[chain];
  const quote = { ok:true,chain_id:profile.chain_id,exact_binding:{taker:WALLET,recipient:WALLET,sell_token:profile.accounting_asset.address,buy_token:TOKEN,sell_amount_base_units:"25000000",buy_amount_base_units:"50000000",minimum_buy_amount_base_units:"49000000"},allowance:{state:"approval_required",spender:SPENDER,required_amount_base_units:"25000000"},blockers:["allowance_required"],fee:{fee_bps:100},expires_at:new Date(Date.now()+45000).toISOString() };
  const approval = evmTokenApprovalContext(quote,{profile,token:{decimals:6},side:"buy",instrument_id:`${chain}:pool:fixture`,pool_address:TOKEN});
  const calls = [];let sent=false;
  const provider = {request:async ({method,params})=>{
    calls.push({method,params});
    if(method === "eth_chainId")return profile.wallet_chain_id_hex;
    if(method === "eth_accounts")return [options.otherWallet?TOKEN:WALLET];
    if(method === "eth_call")return `0x${(sent || options.sufficient?25000000n:0n).toString(16).padStart(64,"0")}`;
    if(method === "eth_estimateGas")return options.gas ?? "0xc350";
    if(method === "eth_sendTransaction") { if(options.reject)throw Object.assign(new Error("user rejected"),{code:4001});sent=true;return HASH; }
    if(method === "eth_getTransactionReceipt")return options.pending?null:{transactionHash:HASH,from:WALLET,to:profile.accounting_asset.address,status:options.failed?"0x0":"0x1",blockHash:HASH};
    throw Error(method);
  }};
  return {quote,approval,calls,args:{profile:chain,approval,provider,address:WALLET,expectedToken:profile.accounting_asset.address,expectedAmount:"25000000",pollIntervalMs:1,timeoutMs:2}};
}
for(const chain of Object.keys(EVM_CHAIN_PROFILES))test(`${chain}: exact amount approval, receipt, then allowance recheck`,async()=>{
  const f=fixture(chain);const result=await globalThis.RavenOSWalletExecution.approveEvmTradeToken(f.args);
  assert.equal(result.state,"confirmed");const sent=f.calls.filter(c=>c.method==="eth_sendTransaction");assert.equal(sent.length,1);
  const tx=sent[0].params[0];assert.equal(tx.value,"0x0");assert.equal(tx.data,`0x095ea7b3${SPENDER.slice(2).padStart(64,"0")}${25000000n.toString(16).padStart(64,"0")}`);
  assert.equal(f.calls.filter(c=>c.method==="eth_call").length,2);
});
for(const [name,options,code] of [["rejection",{reject:true},/user_rejected/],["account switch",{otherWallet:true},/identity_mismatch/],["failed receipt",{failed:true},/approval_failed/],["pending receipt",{pending:true},/submission_indeterminate/]])test(`approval ${name} never proceeds to a trade`,async()=>{const f=fixture("base",options);await assert.rejects(globalThis.RavenOSWalletExecution.approveEvmTradeToken(f.args),code);assert(f.calls.every(c=>c.method!=="eth_sendTransaction"||c.params[0].data.startsWith("0x095ea7b3")));});
test("already sufficient allowance performs no transaction",async()=>{const f=fixture("base",{sufficient:true});assert.equal((await globalThis.RavenOSWalletExecution.approveEvmTradeToken(f.args)).state,"already_sufficient");assert(!f.calls.some(c=>c.method==="eth_sendTransaction"));});
for(const [field,value]of [["spender",TOKEN],["amount_base_units","999999999999"],["wallet_address",TOKEN],["unlimited",true],["chain_id",1]])test(`mismatched ${field} cannot open a wallet`,async()=>{const f=fixture();f.args.approval={...f.approval,[field]:value};await assert.rejects(globalThis.RavenOSWalletExecution.approveEvmTradeToken(f.args),/identity_mismatch/);assert.equal(f.calls.length,0);});
test("insufficient funds and unknown blockers cannot produce an approval request",()=>{const f=fixture();for(const blocker of ["insufficient_balance","invalid_liquidity_sources"])assert.equal(evmTokenApprovalContext({...f.quote,blockers:["allowance_required",blocker]},{profile:"base",token:{decimals:6},side:"buy"}),null);});
test("changing the user intent before the wallet send stops approval",async()=>{const f=fixture();await assert.rejects(globalThis.RavenOSWalletExecution.approveEvmTradeToken({...f.args,assertCurrent:()=>{throw Error("spot_trade_changed");}}),/spot_trade_changed/);assert(!f.calls.some(c=>c.method==="eth_sendTransaction"));});

test("Privy bigint gas estimates retain the same exact approval and gas bounds",async()=>{
  const f=fixture("base",{gas:50000n});await globalThis.RavenOSWalletExecution.approveEvmTradeToken(f.args);
  const tx=f.calls.find(c=>c.method==="eth_sendTransaction").params[0];
  assert.equal(tx.gas,"0xea60");assert.equal(tx.type,"0x0");assert.equal(tx.chainId,"0x2105");
});
for(const gas of [0n,150001n,50000,"50000",-1n])test(`invalid or excessive approval gas ${typeof gas}:${gas} cannot send`,async()=>{
  const f=fixture("base",{gas});await assert.rejects(globalThis.RavenOSWalletExecution.approveEvmTradeToken(f.args),/gas_out_of_bounds/);
  assert.equal(f.calls.some(c=>c.method==="eth_sendTransaction"),false);
});
