import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readExecutionStatusContext } from "../lib/customer_trade/live_execution_status.mjs";
import worker from "../worker.mjs";

const ID = "lex_fixture_transaction_1234";
const HASH = `0x${"ab".repeat(32)}`;
function fixture({chain="solana",state="indeterminate",signature="2".repeat(88)}={}) {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`CREATE TABLE ravenos_customer_live_execution_intents(execution_id TEXT,user_id TEXT,chain_namespace TEXT,state TEXT,prepared_json TEXT,transaction_hash TEXT);
    CREATE TABLE ravenos_customer_live_execution_events(event_id TEXT,execution_id TEXT,state TEXT,evidence_json TEXT,observed_at INTEGER);`);
  const prepared = {wallet_address:"owner-wallet",transaction:{reviewed_transaction_hash:"reviewed-hash"},private_server_evidence:"must not reach the status response"};
  raw.prepare("INSERT INTO ravenos_customer_live_execution_intents VALUES(?,?,?,?,?,?)").run(ID,"user_a",chain,state,JSON.stringify(prepared),chain==="solana"?null:HASH);
  raw.prepare("INSERT INTO ravenos_customer_live_execution_events VALUES(?,?,?,?,?)").run("evt_1",ID,"submission_pending",JSON.stringify({wallet_signature:signature}),1);
  const db = {
    prepare(sql) {
      assert.match(sql,/^SELECT /);
      return { bind(...values) {
        return { async first() { return raw.prepare(sql).get(...values) || null; } };
      } };
    }
  };
  return {raw,db,prepared};
}
test("transaction status requires account authentication before reading execution data",async()=>{
  let reads=0;
  const response=await worker.fetch(new Request("https://app.ravenos.xyz/api/trade/live/status",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ticket_id:ID})}),{RAVENOS_CUSTOMER_DB:{prepare(){reads++;throw Error("unauthenticated execution read");}}});
  assert.notEqual(response.status,200);
  assert.equal(reads,0);
});
test("status cannot inspect another user's ticket or accept an invalid ticket ID",async()=>{
  const {db}=fixture();
  assert.equal(await readExecutionStatusContext(db,ID,"user_b"),null);
  assert.equal(await readExecutionStatusContext(db,ID,null),null);
  assert.equal(await readExecutionStatusContext(db,"' OR 1=1 --","user_a"),null);
});
test("Solana status recovers only the persisted signature and does not reauthorize a buy",async()=>{
  const {db,raw,prepared}=fixture();
  for(let i=0;i<3;i++){
    const context=await readExecutionStatusContext(db,ID,"user_a");
    assert.equal(context.kind,"solana");
    assert.equal(context.signature,"2".repeat(88));
    assert.deepEqual(context.prepared,prepared);
    assert.equal(context.signed_transaction_base64,undefined);
  }
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM ravenos_customer_live_execution_events").get().n,1);
});
test("unsigned quotes and missing signature evidence cannot start reconciliation",async()=>{
  for(const options of [{state:"awaiting_wallet_signature"},{signature:null},{signature:"invalid"}]){
    const {db}=fixture(options);
    const context=await readExecutionStatusContext(db,ID,"user_a");
    assert.equal(context.kind,"pending");
    assert.equal(context.prepared,undefined);
  }
});
for(const chain of ["base","ethereum","bsc","robinhood"])test(`${chain} status reports the existing transaction without constructing or sending a new one`,async()=>{
  const {db}=fixture({chain,state:"reconciliation_pending"});
  const context=await readExecutionStatusContext(db,ID,"user_a");
  assert.equal(context.kind,"evm");
  assert.deepEqual(context.report,{ticket_id:ID,wallet_address:"owner-wallet",reviewed_transaction_hash:"reviewed-hash",transaction_hash:HASH});
  assert.equal(context.prepared,undefined);
});
test("finalized and failed status returns evidence without private prepared data",async()=>{
  for(const state of ["provider_confirmed","provider_rejected"]){
    const {db,raw}=fixture({state});
    raw.prepare("INSERT INTO ravenos_customer_live_execution_events VALUES(?,?,?,?,?)").run("evt_2",ID,state,JSON.stringify({evidence:{economic_result_verified:state==="provider_confirmed"}}),2);
    const context=await readExecutionStatusContext(db,ID,"user_a");
    assert.equal(context.kind,"terminal");
    assert.equal(context.body.ok,state==="provider_confirmed");
    assert.equal(context.body.reconciliation.state,state);
    assert.equal(JSON.stringify(context.body).includes("private_server_evidence"),false);
  }
});
test("unknown chains are never mapped to another execution provider",async()=>{
  const {db}=fixture({chain:"unsupported"});
  assert.equal((await readExecutionStatusContext(db,ID,"user_a")).kind,"pending");
});
