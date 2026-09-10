import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { sqliteStore } from './customer_pro_rewards.test.mjs';
import { readTradeJournal,projectTradeJournalRow,routeTradeJournal,TRADE_JOURNAL_ROUTE } from '../lib/customer_trade/trade_journal.mjs';
import { BASE_EVM_CHAIN_PROFILE,EVM_NATIVE_TOKEN_ADDRESS } from '../lib/customer_trade/evm_chain_profiles.mjs';
import worker from '../worker.mjs';
import { journalAmount } from '../ravenos-trade-journal.js';

const NOW=1789032000,USER='usr_'+'a'.repeat(32),OTHER='usr_'+'b'.repeat(32);
const WALLET='0x'+'1'.repeat(40),TOKEN='0x'+'2'.repeat(40),POOL='0x'+'3'.repeat(40),HASH='0x'+'4'.repeat(64);
const USDC=BASE_EVM_CHAIN_PROFILE.accounting_asset.address;
function row(overrides={}) {
  const id='lex_'+'a'.repeat(24);
  return {execution_id:id,chain_namespace:'base',wallet_address:WALLET,exact_market_id:'base:pool:'+POOL,side:'buy',state:'provider_confirmed',created_at:NOW,observed_at:NOW+1,event_state:'provider_confirmed',transaction_hash:HASH,
    prepared_json:JSON.stringify({ticket_id:id,wallet_address:WALLET,exact_market:{instrument_id:'base:pool:'+POOL,symbol:'MEME'},reviewed_order:{sell_token:USDC,buy_token:TOKEN,expected_buy_amount_base_units:'99999999999'},private_material:'PRIVATE_FIXTURE'}),
    evidence_json:JSON.stringify({state:'provider_confirmed',transaction_hash:HASH,evidence:{economic_result_verified:true,finalized:true,sell_debit_basis:'net_transfer_logs',buy_credit_basis:'net_transfer_logs',sell_debit_base_units:'19000000',buy_credit_base_units:'123456789012345678901',network_fee_native_base_units:'120000000000000',fee_collection:{state:'observed',token:USDC,observed_amount_base_units:'190000'},private_material:'PRIVATE_FIXTURE'}}),
    ...overrides};
}
function setup(t) {
  const db=sqliteStore();t.after(()=>db.raw.close());
  for(const id of [USER,OTHER])db.raw.prepare("INSERT INTO ravenos_users (user_id,state,primary_email,created_at,updated_at,last_authenticated_at) VALUES (?,'active',?,?,?,?)")
    .run(id,id+'@example.test',NOW,NOW,NOW);
  let event=0;
  const add=(number,{user=USER,state='provider_confirmed',time=NOW,submitted=true}={})=>{
    const value=row({execution_id:'lex_'+String(number).padStart(24,'0'),state,event_state:state,created_at:time,transaction_hash:submitted?'0x'+number.toString(16).padStart(64,'0'):null});
    const prepared=JSON.parse(value.prepared_json);prepared.ticket_id=value.execution_id;value.prepared_json=JSON.stringify(prepared);
    const report=JSON.parse(value.evidence_json);report.transaction_hash=value.transaction_hash;value.evidence_json=JSON.stringify(report);
    db.raw.prepare(`INSERT INTO ravenos_customer_live_execution_intents
      (execution_id,schema_version,user_id,venue,chain_namespace,wallet_address,exact_market_id,side,order_type,raven_fee_bps,expected_raven_fee_usdc,fee_collection_method,fee_collection_status,state,prepared_payload_hash,prepared_json,expires_at,created_at,updated_at,transaction_hash)
      VALUES (?,?,?,'zero_x','base',?,?,'buy','market',0,0,'none','disabled',?,?,?,?,?,?,?)`)
      .run(value.execution_id,'fixture.v1',user,WALLET,value.exact_market_id,state,'a'.repeat(64),value.prepared_json,time+300,time,time,value.transaction_hash);
    db.raw.prepare('INSERT INTO ravenos_customer_live_execution_events (event_id,execution_id,state,evidence_json,observed_at) VALUES (?,?,?,?,?)')
      .run('lee_'+String(++event).padStart(24,'0'),value.execution_id,state,value.evidence_json,time+1);
    return value;
  };
  return {db,add};
}
const request=(suffix='',headers={})=>new Request('https://app.ravenos.xyz'+TRADE_JOURNAL_ROUTE+suffix,{headers:{'sec-fetch-site':'same-origin',...headers}});
const authorization={principal:{user_id:USER,session_public_id:'sespub_journal_fixture_1234'},now:NOW,response_headers:new Headers({'set-cookie':'session_refresh=fixture; Secure; HttpOnly'})};

test('journal requires authentication before querying account executions',async()=>{
  let reads=0;
  const response=await routeTradeJournal(request(),{RAVENOS_CUSTOMER_DB:{prepare(){reads++;throw Error('private read');}}},{authorizeRequest:async()=>({response:new Response(null,{status:401})})});
  assert.equal(response.status,401);assert.equal(reads,0);
  const routed=await worker.fetch(request(),{RAVENOS_CUSTOMER_DB:{prepare(){reads++;throw Error('private read');}}});
  assert.notEqual(routed.status,200);assert.equal(reads,0);
});
test('journal is account-scoped, bounded and pages equal timestamps without duplicates',async t=>{
  const {db,add}=setup(t);
  for(let i=1;i<=29;i++)add(i);
  for(let i=30;i<=33;i++)add(i,{user:OTHER,time:NOW+1});
  add(40,{state:'awaiting_wallet_signature',submitted:false});add(41,{state:'expired',submitted:false});add(42,{state:'failed',submitted:false});
  const first=await readTradeJournal(db,USER);assert.equal(first.items.length,25);assert(first.next_cursor);
  const next=await readTradeJournal(db,USER,{cursor:first.next_cursor});assert.equal(next.items.length,4);assert.equal(next.next_cursor,null);
  assert.equal(new Set([...first.items,...next.items].map(v=>v.execution_id)).size,29);
  assert.equal((await readTradeJournal(db,OTHER)).items.length,4);
  assert.deepEqual((await readTradeJournal(db,'usr_'+'c'.repeat(32))).items,[]);
  const output=JSON.stringify(first);assert(!output.includes(USER));assert(!output.includes(WALLET));assert(!output.includes('PRIVATE_FIXTURE'));assert(!output.includes('expected_buy_amount'));
});
test('verified journal amounts come from the receipt and retain integer precision',()=>{
  const value=projectTradeJournalRow(row());
  assert.equal(value.state,'finalized');assert.equal(value.receipt.economic_result_verified,true);
  assert.equal(value.receipt.movements[0].amount_base_units,'-19000000');assert.equal(value.receipt.movements[0].decimals,6);
  assert.equal(value.receipt.movements[1].amount_base_units,'123456789012345678901');assert.equal(value.receipt.movements[1].decimals,null);
  assert.equal(value.receipt.trading_fee.amount_base_units,'190000');assert.equal(value.receipt.network_fee.symbol,'ETH');
  assert.equal(value.explorer_url,'https://basescan.org/tx/'+HASH);
  assert(!JSON.stringify(value).includes('99999999999'));assert(!JSON.stringify(value).includes('PRIVATE_FIXTURE'));
});
for(const mismatch of ['transaction','ticket','wallet','event','json'])test(`a ${mismatch} mismatch cannot publish settled money`,()=>{
  const value=row(),prepared=JSON.parse(value.prepared_json),report=JSON.parse(value.evidence_json);
  if(mismatch==='transaction')report.transaction_hash='0x'+'5'.repeat(64);
  if(mismatch==='ticket')prepared.ticket_id='lex_'+'z'.repeat(24);
  if(mismatch==='wallet')prepared.wallet_address='0x'+'6'.repeat(40);
  if(mismatch==='event')value.event_state='submission_pending';
  value.prepared_json=JSON.stringify(prepared);value.evidence_json=mismatch==='json'?'malformed':JSON.stringify(report);
  const result=projectTradeJournalRow(value);assert.equal(result.state,'pending_receipt');assert.equal(result.receipt.economic_result_verified,false);
  assert.deepEqual(result.receipt.movements,[]);assert.equal(result.receipt.trading_fee,null);assert.equal(result.receipt.network_fee,null);
});
test('native transaction value is not represented as net spend after refunds',()=>{
  const value=row(),prepared=JSON.parse(value.prepared_json),report=JSON.parse(value.evidence_json);
  prepared.reviewed_order.sell_token=EVM_NATIVE_TOKEN_ADDRESS;report.evidence.sell_debit_basis='transaction_value';
  value.prepared_json=JSON.stringify(prepared);value.evidence_json=JSON.stringify(report);
  const result=projectTradeJournalRow(value);assert.equal(result.receipt.movements.length,1);assert.equal(result.receipt.movements[0].address,TOKEN);
});
test('an indeterminate or reversed fee is not counted as a collected trading fee',()=>{
  const value=row(),report=JSON.parse(value.evidence_json);
  report.evidence.fee_collection={state:'indeterminate',token:USDC,observed_amount_base_units:null,net_amount_base_units:'-190000'};
  value.evidence_json=JSON.stringify(report);assert.equal(projectTradeJournalRow(value).receipt.trading_fee,null);
});
test('canonical confirmation and provider finality remain distinct',()=>{
  const value=row(),report=JSON.parse(value.evidence_json);report.evidence.finalized=false;value.evidence_json=JSON.stringify(report);
  const result=projectTradeJournalRow(value);assert.equal(result.state,'confirmed');assert.equal(result.receipt.finalized,false);
});
test('same-second receipt updates use insertion order and return one journal entry',async t=>{
  const {db,add}=setup(t),value=add(1);
  const report=JSON.parse(value.evidence_json);report.evidence.finalized=false;
  db.raw.prepare('INSERT INTO ravenos_customer_live_execution_events (event_id,execution_id,state,evidence_json,observed_at) VALUES (?,?,?,?,?)')
    .run('lee_'+'0'.repeat(23)+'0',value.execution_id,'provider_confirmed',JSON.stringify(report),NOW+1);
  const result=await readTradeJournal(db,USER);assert.equal(result.items.length,1);assert.equal(result.items[0].state,'confirmed');
});
test('Solana uses its persisted signature and keeps native fee/rent movements distinct',()=>{
  const wallet=bs58.encode(Buffer.alloc(32,5)),mint=bs58.encode(Buffer.alloc(32,7)),signature=bs58.encode(Buffer.alloc(64,8));
  const value=row({chain_namespace:'solana',wallet_address:wallet,transaction_hash:null,exact_market_id:'solana:pool:fixture'});
  value.prepared_json=JSON.stringify({ticket_id:value.execution_id,wallet_address:wallet,exact_market:{instrument_id:value.exact_market_id,selected_token_mint:mint},transaction:{message_hash:'a'.repeat(64)}});
  value.submission_json=JSON.stringify({wallet_signature:signature,message_hash:'a'.repeat(64)});
  value.evidence_json=JSON.stringify({state:'provider_confirmed',signature,evidence:{economic_result_verified:true,settled_message_hash:'a'.repeat(64),confirmation_status:'confirmed',selected_token_delta_base_units:'123456789012345678901',usdc_delta_base_units:'-19000000',native_debit_lamports:'2005000',native_credit_lamports:'0',fee_lamports:'5000',raven_fee:{verified:true,fee_mint:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',gross_fee_amount_base_units:'190000'}}});
  const result=projectTradeJournalRow(value);assert.equal(result.state,'confirmed');assert.equal(result.transaction_reference,signature);
  assert.equal(result.selected_token_address,mint);
  assert.equal(result.receipt.movements[0].amount_base_units,'123456789012345678901');assert.equal(result.receipt.movements[0].decimals,null);
  const native=result.receipt.movements.find(v=>v.asset_id==='solana:native');assert.equal(native.amount_base_units,'-2005000');assert.match(native.basis,/fees_and_rent/);
  assert.equal(result.receipt.network_fee.amount_base_units,'5000');assert.equal(result.receipt.network_fee.asset_id,'solana:native');
  const report=JSON.parse(value.evidence_json);report.evidence.settled_message_hash='b'.repeat(64);value.evidence_json=JSON.stringify(report);
  assert.equal(projectTradeJournalRow(value).receipt.economic_result_verified,false);
  value.submission_json=JSON.stringify({wallet_signature:signature});assert.equal(projectTradeJournalRow(value).receipt.economic_result_verified,false);
});
test('duplicate observations of the same asset do not double count, and conflicts remain excluded',()=>{
  const value=row(),prepared=JSON.parse(value.prepared_json),report=JSON.parse(value.evidence_json);
  prepared.reviewed_order.buy_token=USDC;report.evidence.sell_debit_base_units='0';report.evidence.buy_credit_base_units='0';
  value.prepared_json=JSON.stringify(prepared);value.evidence_json=JSON.stringify(report);
  assert.equal(projectTradeJournalRow(value).receipt.movements.length,1);
  report.evidence.buy_credit_base_units='1';value.evidence_json=JSON.stringify(report);
  assert.deepEqual(projectTradeJournalRow(value).receipt.movements,[]);
});
test('malformed cursors, owner overrides and cross-origin requests fail before private reads',async()=>{
  let authorized=0;
  const deps={authorizeRequest:async()=>{authorized++;throw Error('not reached');}};
  for(const req of [request('?user_id='+OTHER),request('?cursor=garbage'),request('?cursor=a&cursor=b'),request('',{'origin':'https://elsewhere.test'}),request('',{'sec-fetch-site':'cross-site'})]) {
    const response=await routeTradeJournal(req,{},deps);assert([400,403].includes(response.status));assert.match(response.headers.get('cache-control'),/private.*no-store/);
  }
  assert.equal(authorized,0);
});
test('read-only responses preserve cookie refresh and never convert a database outage to empty history',async t=>{
  const {db,add}=setup(t);add(1);let reads=0;
  const readonly={prepare(sql){assert.match(sql,/^SELECT /);reads++;return db.prepare(sql);}};
  const deps={authorizeRequest:async()=>authorization};
  const ok=await routeTradeJournal(request(),{RAVENOS_CUSTOMER_DB:readonly},deps);assert.equal(ok.status,200);assert.equal(reads,1);
  assert.match(ok.headers.get('cache-control'),/private.*no-store/);assert.match(ok.headers.get('set-cookie'),/session_refresh/);
  assert.equal((await ok.json()).items.length,1);
  const fail=await routeTradeJournal(request(),{RAVENOS_CUSTOMER_DB:{prepare(){throw Error('PRIVATE_DATABASE_FAILURE');}}},deps);
  assert.equal(fail.status,503);assert.deepEqual(await fail.json(),{ok:false,error:'trade_history_unavailable'});
});

test('submitted failures are retained without claiming a fill or a fee',()=>{
  const result=projectTradeJournalRow(row({state:'failed',event_state:'failed'}));
  assert.equal(result.state,'failed');assert.equal(result.receipt.economic_result_verified,false);assert.equal(result.receipt.trading_fee,null);assert.deepEqual(result.receipt.movements,[]);
});
test('display amounts preserve exact large integers and tiny native fees',()=>{
  assert.equal(journalAmount({amount_base_units:'123456789012345678901',decimals:18,symbol:'ETH'}),'123.456789012345678901 ETH');
  assert.equal(journalAmount({amount_base_units:'1',decimals:18,symbol:'ETH'}),'0.000000000000000001 ETH');
  assert.equal(journalAmount({amount_base_units:'-19000000',decimals:6,symbol:'USDC'}),'−19 USDC');
  assert.equal(journalAmount({amount_base_units:'123456789012345678901',decimals:null}),'123,456,789,012,345,678,901 base units');
  for(const value of [null,{amount_base_units:0},{amount_base_units:'NaN'},{amount_base_units:'1e18'},{amount_base_units:'01'}])assert.equal(journalAmount(value),'Unavailable');
});
